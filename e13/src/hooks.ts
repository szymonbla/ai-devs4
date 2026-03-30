/**
 * Hook: onToolCallFinish
 *
 * Intercepts raw API responses from send_command and parses them
 * into a minimal BoardState with pre-computed danger assessment.
 * The LLM receives a clear recommendation — no reasoning needed.
 */

export interface BlockState {
  col: number;
  bottom_row: number;
  direction: "up" | "down";
  next_bottom_row: number;
}

export interface BoardState {
  player_col: number;
  reached_goal: boolean;
  blocks: BlockState[];
  danger: Record<number, boolean>; // col → dangerous at row 5 after next move
  recommended_action: string;
}

function nextBottomRow(b: { bottom_row: number; top_row: number; direction: string }): number {
  const height = b.bottom_row - b.top_row; // block height = bottom - top
  if (b.direction === "down") {
    // moving down, check if bottom would exceed row 5
    return b.bottom_row >= 5 ? b.bottom_row - 1 : b.bottom_row + 1;
  } else {
    // moving up, check if top would go above row 1
    return b.top_row <= 1 ? b.bottom_row + 1 : b.bottom_row - 1;
  }
}

function isDangerousAfterMove(b: { bottom_row: number; top_row: number; direction: string }): boolean {
  const nextBottom = nextBottomRow(b);
  // dangerous if the block will occupy row 5 after the move
  // block occupies rows from (nextBottom - height) to nextBottom
  const height = b.bottom_row - b.top_row;
  const nextTop = nextBottom - height;
  return nextBottom >= 5 && nextTop <= 5;
}

function parseBoardState(data: Record<string, unknown>): BoardState | null {
  const player = data.player as { col: number; row: number } | undefined;
  const goal = data.goal as { col: number; row: number } | undefined;
  const rawBlocks = data.blocks as Array<{
    col: number;
    top_row: number;
    bottom_row: number;
    direction: string;
  }> | undefined;

  if (!player) return null;

  const playerCol = player.col;
  const reachedGoal = goal ? playerCol === goal.col : playerCol === 7;

  const blocks: BlockState[] = (rawBlocks ?? []).map((b) => ({
    col: b.col,
    bottom_row: b.bottom_row,
    direction: b.direction as "up" | "down",
    next_bottom_row: nextBottomRow(b),
  }));

  // Compute danger map: which columns are dangerous after next move
  const danger: Record<number, boolean> = {};
  for (const b of rawBlocks ?? []) {
    danger[b.col] = isDangerousAfterMove(b);
  }

  // Compute recommended action
  let recommended: string;
  if (reachedGoal) {
    recommended = "STOP — goal reached!";
  } else {
    const nextCol = playerCol + 1;
    const currCol = playerCol;
    const prevCol = playerCol - 1;

    const nextSafe = !danger[nextCol]; // no block or block is safe
    const currSafe = !danger[currCol];

    if (nextSafe) {
      recommended = `right — column ${nextCol} is safe after move`;
    } else if (currSafe) {
      recommended = `wait — column ${nextCol} dangerous, current column ${currCol} is safe`;
    } else if (prevCol >= 1) {
      recommended = `left — both column ${nextCol} and ${currCol} dangerous, retreat to ${prevCol}`;
    } else {
      recommended = `wait — at edge, cannot retreat further`;
    }
  }

  return { player_col: playerCol, reached_goal: reachedGoal, blocks, danger, recommended_action: recommended };
}

export function onToolCallFinish(
  toolName: string,
  rawResult: unknown,
): string {
  if (toolName !== "send_command") {
    return typeof rawResult === "string"
      ? rawResult
      : JSON.stringify(rawResult);
  }

  const raw =
    typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

  const rawStr = JSON.stringify(raw);

  // Check for flag in response
  const flagMatch = rawStr.match(/\{FLG:[^}]+\}/);
  if (flagMatch) {
    console.log("Flag found:", flagMatch[0]);
    return JSON.stringify({
      player_col: 7,
      reached_goal: true,
      flag: flagMatch[0],
      recommended_action: "STOP — goal reached! Submit this flag.",
    });
  }

  const data = raw as Record<string, unknown>;
  const boardState = parseBoardState(data);
  if (boardState) {
    const dangerCols = Object.entries(boardState.danger)
      .filter(([, v]) => v)
      .map(([k]) => k);
    console.log(
      `[hook] col=${boardState.player_col} danger=[${dangerCols.join(",")}] → ${boardState.recommended_action}`,
    );
    return JSON.stringify(boardState);
  }

  console.warn("[hook] could not parse board state, passing raw");
  return rawStr;
}

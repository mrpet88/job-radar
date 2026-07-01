import type { Board, Job } from "../../types.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import { fetchAshby } from "./ashby.js";
import { fetchWorkday } from "./workday.js";

// Route a registry board to its vendor fetcher.
export function fetchBoard(board: Board): Promise<Job[]> {
  switch (board.vendor) {
    case "greenhouse": return fetchGreenhouse(board);
    case "lever":      return fetchLever(board);
    case "ashby":      return fetchAshby(board);
    case "workday":    return fetchWorkday(board);
  }
}

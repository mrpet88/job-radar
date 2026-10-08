import type { Board, Job } from "../../types.js";
import type { FetchOpts } from "../../util/http.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import { fetchAshby } from "./ashby.js";
import { fetchWorkday } from "./workday.js";
import { fetchRecruitee } from "./recruitee.js";
import { fetchWorkable } from "./workable.js";
import { fetchSmartRecruiters } from "./smartrecruiters.js";
import { fetchTeamtailor } from "./teamtailor.js";
import { fetchSuccessFactors } from "./successfactors.js";

// Route a registry board to its vendor fetcher. `opts` lets a caller override the
// HTTP timeout and retries: probing wants to fail fast on a guessed slug, while a
// real harvest should wait out a slow board. `titleGate` is for vendors that pay a
// request per posting to get its body (SuccessFactors) — only titles that pass it
// are fetched in full; every other vendor delivers bodies in the list call.
export function fetchBoard(
  board: Board, opts?: FetchOpts, titleGate?: (title: string) => boolean,
): Promise<Job[]> {
  switch (board.vendor) {
    case "greenhouse":      return fetchGreenhouse(board, opts);
    case "lever":           return fetchLever(board, opts);
    case "ashby":           return fetchAshby(board, opts);
    case "workday":         return fetchWorkday(board, opts);
    case "recruitee":       return fetchRecruitee(board, opts);
    case "workable":        return fetchWorkable(board, opts);
    case "smartrecruiters": return fetchSmartRecruiters(board, opts);
    case "teamtailor":      return fetchTeamtailor(board, opts);
    case "successfactors":  return fetchSuccessFactors(board, opts, titleGate);
  }
}

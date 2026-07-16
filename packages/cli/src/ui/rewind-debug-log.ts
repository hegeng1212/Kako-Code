/** @deprecated Prefer `cli-debug-log.js` — re-exports gated CLI debug helpers. */
export {
  CLI_DEBUG_LOG_PATH as REWIND_DEBUG_LOG_PATH,
  getCliDebugLogPath as getRewindDebugLogPath,
  debugLog as rewindDebugLog,
  debugChunk as rewindDebugChunk,
  debugStack as rewindDebugStack,
  debugError as rewindDebugError,
  enableCliDebug,
  isCliDebugEnabled,
} from "./cli-debug-log.js";

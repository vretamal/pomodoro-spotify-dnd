import { Cache, getPreferenceValues, launchCommand, LaunchType, LocalStorage } from "@raycast/api";
import { FocusText, LongBreakText, ShortBreakText } from "./constants";
import { Interval, IntervalExecutor, IntervalType } from "./types";
import { runAppleScript } from "@raycast/utils";

const cache = new Cache();

const CURRENT_INTERVAL_CACHE_KEY = "pomodoro-interval/1.1";
const COMPLETED_POMODORO_COUNT_CACHE_KEY = "pomodoro-interval/completed-pomodoro-count";
const POMODORO_INTERVAL_HISTORY = "pomodoro-interval/history";

const SPOTIFY_PLAYLISTS_URI = [
  "spotify:playlist:37i9dQZF1DWZeKCadgRdKQ",
  "spotify:playlist:37i9dQZF1DWSluGMsH1R9r",
  "spotify:playlist:37i9dQZF1DWYmSg58uBxin",
  "spotify:playlist:37i9dQZF1DX8wWHvPMMfNA",
  "spotify:playlist:37i9dQZF1DX45qfzFXwcta",
  "spotify:playlist:37i9dQZF1DWVTkoPB1rnwz",
  "spotify:playlist:37i9dQZF1DWZZbwlv3Vmtr",
];

const getSpotifyPlaylist = () => {
  const randomIndex = Math.floor(Math.random() * SPOTIFY_PLAYLISTS_URI.length);
  return SPOTIFY_PLAYLISTS_URI[randomIndex];
};

const playRandomSpotifyPlaylist = async () => {
  const playlistUri = getSpotifyPlaylist();
  const script = `
    tell application "Spotify"
      play track "${playlistUri}"
    end tell
  `;

  await runAppleScript(script);
};

const stopSpotify = async () => {
  const script = `
    tell application "Spotify"
      pause
    end tell
  `;

  await runAppleScript(script);
};

const currentTimestamp = () => Math.round(new Date().valueOf() / 1000);

export async function getIntervalHistory(): Promise<Interval[]> {
  const history = await LocalStorage.getItem(POMODORO_INTERVAL_HISTORY);

  if (typeof history !== "string" || history === null) {
    return [];
  }
  const intervales = JSON.parse(history);
  return intervales;
}

export async function saveIntervalHistory(interval: Interval) {
  const history = await getIntervalHistory();
  const index = history.findIndex((i) => i.id === interval.id);

  if (index !== -1) {
    history[index] = interval;
  } else {
    history.push(interval);
  }

  await LocalStorage.setItem(POMODORO_INTERVAL_HISTORY, JSON.stringify(history));
}

export function duration({ parts }: Interval): number {
  return parts.reduce((acc, part) => {
    return (
      (typeof part.pausedAt !== "undefined" ? part.pausedAt - part.startedAt : currentTimestamp() - part.startedAt) +
      acc
    );
  }, 0);
}

export function progress(interval: Interval): number {
  return (duration(interval) / interval.length) * 100;
}

export function isPaused({ parts }: Interval): boolean {
  return !!parts[parts.length - 1].pausedAt;
}

export function createInterval(type: IntervalType, isFreshStart?: boolean): Interval {
  let completedCount = 0;
  if (isFreshStart) {
    cache.set(COMPLETED_POMODORO_COUNT_CACHE_KEY, completedCount.toString());
  } else {
    completedCount = parseInt(cache.get(COMPLETED_POMODORO_COUNT_CACHE_KEY) ?? "0", 10);
    completedCount++;
    cache.set(COMPLETED_POMODORO_COUNT_CACHE_KEY, completedCount.toString());
  }
  const interval: Interval = {
    type,
    id: completedCount,
    length: intervalDurations[type],
    parts: [
      {
        startedAt: currentTimestamp(),
      },
    ],
  };
  cache.set(CURRENT_INTERVAL_CACHE_KEY, JSON.stringify(interval));
  saveIntervalHistory(interval).then();
  if (type === "focus") {
    launchCommand({
      extensionName: "do-not-disturb",
      name: "on",
      ownerOrAuthorName: "yakitrak",
      type: LaunchType.Background,
    });
    playRandomSpotifyPlaylist()
      .then(() => {
        console.log("Playing random Spotify playlist");
      })
      .catch((error) => {
        console.error(error);
      });
  }
  return interval;
}

export function pauseInterval(): Interval | undefined {
  let interval = getCurrentInterval();
  if (interval) {
    const parts = [...interval.parts];
    parts[parts.length - 1].pausedAt = currentTimestamp();
    interval = {
      ...interval,
      parts,
    };
    cache.set(CURRENT_INTERVAL_CACHE_KEY, JSON.stringify(interval));
  }

  return interval;
}

export function continueInterval(): Interval | undefined {
  let interval = getCurrentInterval();
  if (interval) {
    const parts = [...interval.parts, { startedAt: currentTimestamp() }];
    interval = {
      ...interval,
      parts,
    };
    cache.set(CURRENT_INTERVAL_CACHE_KEY, JSON.stringify(interval));
  }
  return interval;
}

export function resetInterval() {
  console.log("restating interval");
  try {
    launchCommand({
      extensionName: "do-not-disturb",
      name: "off",
      ownerOrAuthorName: "yakitrak",
      type: LaunchType.Background,
    });
    stopSpotify()
      .then(() => {
        console.log("Spotify paused");
      })
      .catch((error) => {
        console.error(error);
      });
  } catch (error) {
    console.error(error);
  }
  cache.remove(CURRENT_INTERVAL_CACHE_KEY);
}

export function restartInterval() {
  const currentInterval = getCurrentInterval();
  if (currentInterval) {
    const { type } = currentInterval;
    createInterval(type, false); // Uses existing caching mechanism to reset interval
  }
}

export function getCurrentInterval(): Interval | undefined {
  const result = cache.get(CURRENT_INTERVAL_CACHE_KEY);
  if (result) {
    return JSON.parse(result);
  }
}

export function endOfInterval(currentInterval: Interval) {
  try {
    currentInterval.parts[currentInterval.parts.length - 1].endAt = currentTimestamp();
    saveIntervalHistory(currentInterval).then();
    launchCommand({
      name: "pomodoro-control-timer",
      type: LaunchType.UserInitiated,
      context: { currentInterval },
    });
  } catch (error) {
    console.error(error);
  }
}

export function getCompletedPomodoroCount(): number {
  const result = cache.get(COMPLETED_POMODORO_COUNT_CACHE_KEY);
  if (result) {
    return parseInt(result, 10);
  }

  return 0;
}

export function getNextIntervalExecutor(): IntervalExecutor {
  const currentInterval = getCurrentInterval();
  resetInterval();

  const completedCount = getCompletedPomodoroCount();
  const longBreakThreshold = parseInt(preferences.longBreakStartThreshold, 10);
  let executor: IntervalExecutor | undefined;
  switch (currentInterval?.type) {
    case "short-break":
      executor = { title: FocusText, onStart: () => createInterval("focus", false) };
      break;
    case "long-break":
      executor = { title: FocusText, onStart: () => createInterval("focus") };
      break;
    default:
      if (completedCount === longBreakThreshold) {
        executor = {
          title: LongBreakText,
          onStart: () => createInterval("long-break"),
        };
      } else {
        executor = {
          title: ShortBreakText,
          onStart: () => createInterval("short-break", false),
        };
      }
      break;
  }

  return executor;
}

export const preferences = getPreferenceValues<Preferences>();
export const intervalDurations: Record<IntervalType, number> = {
  focus: parseInt(preferences.focusIntervalDuration) * 60,
  "short-break": parseInt(preferences.shortBreakIntervalDuration) * 60,
  "long-break": parseInt(preferences.longBreakIntervalDuration) * 60,
};

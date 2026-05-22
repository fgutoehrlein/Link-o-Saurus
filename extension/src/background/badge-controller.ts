import { listDueReadLater } from '../shared/db';

const READ_LATER_ALARM_NAME = 'link-o-saurus:read-later-refresh';
const READ_LATER_REFRESH_INTERVAL_MINUTES = 1;
const READ_LATER_BADGE_COLOR = '#DC2626';

const formatBadgeCount = (count: number): string => {
  if (count <= 0) {
    return '';
  }
  if (count > 99) {
    return '99+';
  }
  return `${count}`;
};

export const updateReadLaterBadge = async (): Promise<number> => {
  if (!chrome.action?.setBadgeText) {
    return 0;
  }

  try {
    const dueEntries = await listDueReadLater();
    const count = dueEntries.length;
    const text = formatBadgeCount(count);
    await chrome.action.setBadgeBackgroundColor({ color: READ_LATER_BADGE_COLOR });
    await chrome.action.setBadgeText({ text });
    return count;
  } catch (error) {
    console.error('[Link-o-Saurus] Failed to update read later badge', error);
    try {
      await chrome.action.setBadgeText({ text: '' });
    } catch (innerError) {
      console.warn('[Link-o-Saurus] Unable to reset badge text', innerError);
    }
    return 0;
  }
};

export const ensureReadLaterAlarm = async (): Promise<void> => {
  try {
    const existing = await chrome.alarms.get(READ_LATER_ALARM_NAME);
    if (existing) {
      return;
    }
    await chrome.alarms.create(READ_LATER_ALARM_NAME, {
      delayInMinutes: 0.1,
      periodInMinutes: READ_LATER_REFRESH_INTERVAL_MINUTES,
    });
  } catch (error) {
    console.error('[Link-o-Saurus] Failed to register read later alarm', error);
  }
};

export const registerBadgeController = (): void => {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === READ_LATER_ALARM_NAME) {
      void updateReadLaterBadge();
    }
  });
};

// Single-slot arrival reminder persisted to localStorage.
// Fires once per reminder when the train reaches (or passes) the station
// immediately before the user's destination.

const KEY = "train-reminder-v1";
const EVENT = "reminder-change";

export interface Reminder {
  trainCode: string;
  destStationCode: string;
  destStationName: string;
  date: string;
  notified: boolean;
}

export function loadReminder(): Reminder | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Reminder;
    if (!r || typeof r.trainCode !== "string") return null;
    return r;
  } catch {
    return null;
  }
}

export function saveReminder(r: Reminder): void {
  localStorage.setItem(KEY, JSON.stringify(r));
  window.dispatchEvent(new CustomEvent<Reminder | null>(EVENT, { detail: r }));
}

export function clearReminder(): void {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent<Reminder | null>(EVENT, { detail: null }));
}

export function onReminderChange(handler: (r: Reminder | null) => void): () => void {
  const wrapped = (e: Event) => handler((e as CustomEvent<Reminder | null>).detail);
  window.addEventListener(EVENT, wrapped);
  return () => window.removeEventListener(EVENT, wrapped);
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function fireNativeNotification(title: string, body: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icon-192.png", tag: "train-arrival" });
  } catch {
    // non-secure context or unsupported — silently skip (in-app toast still fires)
  }
}

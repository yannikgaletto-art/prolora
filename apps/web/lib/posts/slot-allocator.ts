export interface PostingSlot {
  id: string;
  connection_id: string | null;
  day_of_week: number;
  local_time: string;
  timezone: string;
  is_active: boolean;
}

export interface AllocatedSlot {
  slotId: string;
  instant: string;
  timezone: string;
  localDate: string;
  localTime: string;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MAX_LOOKAHEAD_DAYS = 60;

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function localOccurrenceCandidates(
  localDate: string,
  localTime: string,
  timezone: string
): string[] {
  if (!isValidTimeZone(timezone)) return [];
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(localTime);
  if (!dateMatch || !timeMatch) return [];
  const wanted: LocalParts = {
    year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), second: Number(timeMatch[3] ?? 0),
  };
  const naive = Date.UTC(
    wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second
  );
  const offsets = new Set<number>();
  for (const delta of [-86_400_000, 0, 86_400_000]) {
    offsets.add(timeZoneOffsetMs(new Date(naive + delta), timezone));
  }
  return [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((candidate) => sameLocalParts(partsInZone(candidate, timezone), wanted))
    .sort((a, b) => a.getTime() - b.getTime())
    .map((candidate) => candidate.toISOString());
}

export function allocateNextSlot(input: {
  slots: PostingSlot[];
  occupiedInstants: string[];
  now: Date;
}): AllocatedSlot | null {
  const slots = input.slots.filter((slot) => slot.is_active && isValidTimeZone(slot.timezone));
  if (slots.length === 0) return null;
  const occupied = new Set(
    input.occupiedInstants.map((value) => new Date(value).getTime()).filter(Number.isFinite)
  );
  const latest = input.now.getTime() + MAX_LOOKAHEAD_DAYS * 86_400_000;
  const candidates: AllocatedSlot[] = [];

  for (const slot of slots) {
    const today = partsInZone(input.now, slot.timezone);
    const base = Date.UTC(today.year, today.month - 1, today.day);
    for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset++) {
      const local = new Date(base + offset * 86_400_000);
      if (local.getUTCDay() !== slot.day_of_week) continue;
      const localDate = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
      for (const instant of localOccurrenceCandidates(localDate, slot.local_time, slot.timezone)) {
        const timestamp = new Date(instant).getTime();
        if (timestamp <= input.now.getTime() || timestamp > latest || occupied.has(timestamp)) continue;
        candidates.push({
          slotId: slot.id,
          instant,
          timezone: slot.timezone,
          localDate,
          localTime: slot.local_time,
        });
      }
    }
  }
  return candidates.sort((a, b) => a.instant.localeCompare(b.instant))[0] ?? null;
}

function partsInZone(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'), second: get('second'),
  };
}

function timeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = partsInZone(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(date.getTime() / 1000) * 1000;
}

function sameLocalParts(a: LocalParts, b: LocalParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day &&
    a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

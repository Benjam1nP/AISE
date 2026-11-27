const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const OPENING_MINUTE = 7 * 60;
const CLOSING_MINUTE = 20 * 60;

interface ZurichParts {
  year: string;
  month: string;
  day: string;
  weekday: string;
  minuteOfDay: number;
}

const zurichFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Validates booking time slots against the Europe/Zurich opening rules.
 * @trace DSN-009 REQ-007 REQ-002
 */
export class TimeSlotPolicy {
  constructor() {
    // Stateless policy; no attributes to initialise.
  }

  validate(start: Date, end: Date, now: Date): void {
    if (!(start instanceof Date) || isNaN(start.getTime())) {
      throw new Error('Invalid start time');
    }
    if (!(end instanceof Date) || isNaN(end.getTime())) {
      throw new Error('Invalid end time');
    }
    if (!(now instanceof Date) || isNaN(now.getTime())) {
      throw new Error('Invalid current time');
    }

    const startMs = start.getTime();
    const endMs = end.getTime();

    if (startMs % FIFTEEN_MINUTES_MS !== 0) {
      throw new Error('Start must fall on a 15-minute step');
    }
    if (endMs % FIFTEEN_MINUTES_MS !== 0) {
      throw new Error('End must fall on a 15-minute step');
    }

    const duration = endMs - startMs;
    if (duration < FIFTEEN_MINUTES_MS) {
      throw new Error('Booking must last at least 15 minutes');
    }
    if (duration > FOUR_HOURS_MS) {
      throw new Error('Booking must last at most 4 hours');
    }

    if (startMs <= now.getTime()) {
      throw new Error('Booking start must be in the future');
    }
    if (startMs - now.getTime() > SIXTY_DAYS_MS) {
      throw new Error('Booking start must be at most 60 days ahead');
    }

    const s = this.zurichParts(start);
    const e = this.zurichParts(end);

    if (s.weekday === 'Sat' || s.weekday === 'Sun') {
      throw new Error('Bookings are not allowed on weekends');
    }
    if (s.year !== e.year || s.month !== e.month || s.day !== e.day) {
      throw new Error('Booking must start and end on the same day');
    }
    if (s.minuteOfDay < OPENING_MINUTE) {
      throw new Error('Booking must start at or after 07:00 Europe/Zurich');
    }
    if (e.minuteOfDay > CLOSING_MINUTE) {
      throw new Error('Booking must end at or before 20:00 Europe/Zurich');
    }
  }

  private zurichParts(date: Date): ZurichParts {
    const parts = zurichFormatter.formatToParts(date);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? '';
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      weekday: get('weekday'),
      minuteOfDay: hour * 60 + minute,
    };
  }
}

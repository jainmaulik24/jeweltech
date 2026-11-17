export interface Clock {
    now(): Date;
}

const systemClock: Clock = { now: () => new Date() };
let activeClock: Clock = systemClock;

export function setClock(clock: Clock | null): void {
    activeClock = clock ?? systemClock;
}

export function now(): Date {
    return activeClock.now();
}

export * from './core/index';
export * from './errors';
export type { Observable, Subscription } from 'rxjs';

declare global {
    // Adapter hook for ambient augmentation; intentionally empty.
}

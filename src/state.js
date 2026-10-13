// The single store instance, shared by every screen.

import { Store } from './data/store.js';
import { createDb } from './data/db.js';

export const store = new Store(createDb());

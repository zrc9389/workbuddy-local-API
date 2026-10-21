import { initEndpoints } from './assets/endpoints.js';
'use strict';
// Module entry: each view owns its state and behavior.
import './assets/theme.js';
import './assets/router.js';
import { initAuth } from './assets/auth.js';
initEndpoints();
initAuth();

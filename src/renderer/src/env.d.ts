import type { DevCommandAPI } from '../../shared/contracts'
declare global { interface Window { devcommand: DevCommandAPI } }

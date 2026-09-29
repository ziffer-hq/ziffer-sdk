import { tool } from './tool.js';

/**
 * A read-only server: every tool reads, none sends, none takes text from the
 * web. No pair may fire here and nothing may be irreversible or egress.
 */
export const BENIGN = [
  tool('Claude Code', 'weather', 'get_forecast', 'Returns the forecast for a city.', ['city', 'days']),
  tool('Claude Code', 'weather', 'list_stations', 'Lists weather stations near a point.', ['latitude', 'longitude', 'next_token']),
  tool('Claude Code', 'calculator', 'describe_units', 'Describes the supported units.', []),
];

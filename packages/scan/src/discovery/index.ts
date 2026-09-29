export { discover, type DiscoveryResult, type Unreadable } from './discover.js';
export type { DiscoveredServer, SkippedServer } from './shapes.js';
export { loadClientsData, parseClientsData, ClientsDataInvalid, type ClientsData, type ClientEntry, type Platform } from './clients.js';
export { JsonUnreadable } from './jsonc.js';
export { TomlShapeUnsupported } from './toml.js';
export { YamlShapeUnsupported } from './yaml.js';
export {
  clientsPhrase,
  configuredPhrase,
  distinct,
  groupBySignature,
  groupServers,
  groupSkipped,
  skippedSignature,
  startSignature,
  type StartGroup,
} from './group.js';

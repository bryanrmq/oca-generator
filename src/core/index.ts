/**
 * The public API of the OCA logic, published as the npm package `@bryanrmq/oca-generator`
 * (`packages/oca-generator`). The web app imports the modules of `src/core` directly; this entry is what
 * other tools get. It runs in Node 20+ and in browsers: the only platform features it uses are Web Crypto,
 * `TextEncoder`, `atob` and `btoa`. Relative imports in `src/core` name their `.ts` file so the package
 * compiles to ES modules Node can load.
 *
 * Typical use: `parseProjectFile` → `exportProject` (or `validate`, `buildBundle`, `buildOutputs` and
 * `buildTypeMetadata`, `vctMetadataIntegrity` and `buildIssuerMetadata` one by one), and `filePlaceholders` for what
 * is left to fill in.
 * `importBundle` goes the other way, from a bundle to a project.
 */

// The project model: what a project file holds and the functions below take.
export type {
  AttrType,
  AttributeNode,
  Branding,
  BrandingPair,
  ClaimsPath,
  Entries,
  Group,
  GroupLink,
  Hosting,
  I14yLink,
  IssuerSettings,
  LangTag,
  Meta,
  Node,
  PathSegment,
  PrimitiveType,
  Project,
} from './model.ts';

// Issuer settings (`project.issuer`): defaults and checks shared by the Type Metadata and Issuer Metadata files.
export { FALLBACK_IDENTIFIER_BASE, IDENTIFIER_PATTERN, defaultIdentifiers, isIssuerLogo, isIssuerUrl, issuerIdentifiers, issuerOf, issuerUrl } from './issuer.ts';
export type { IssuerIdentifiers } from './issuer.ts';

// Project files (`*.credential-project.json`), as the app saves and opens them.
export {
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  isProject,
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
} from './projectFile.ts';
export type { ParsedProjectFile, ProjectFileError } from './projectFile.ts';
export type { Baseline, BaselineSource } from './baseline.ts';

// Validation: the issues the app lists, each an error (blocks the export) or a warning.
export { hasErrors, validate } from './validate/index.ts';
export type { CredentialField, Issue, IssueTarget, NodeField, Severity } from './validate/index.ts';

// Export: the bundle, its text and `#integrity`, and the Type Metadata (`vct.json`).
export { exportProject } from './export/project.ts';
export type { ProjectExport } from './export/project.ts';
export { buildBundle, serializeBundle } from './export/bundle.ts';
export type { BuiltBundle, BundleJson, CaptureBaseJson, OverlayJson } from './export/bundle.ts';
export { BUNDLE_FILE_NAME, VCT_FILE_NAME, buildOutputs, bundleDataUrl, bundleIntegrity } from './export/outputs.ts';
export type { ExportOutputs } from './export/outputs.ts';
export { buildTypeMetadata, serializeTypeMetadata, typeMetadataUri } from './export/typeMetadata.ts';
export type { BuiltTypeMetadata, TypeMetadata, TypeMetadataDisplay, TypeMetadataOca } from './export/typeMetadata.ts';

// The swiyu generic issuer's `issuer_metadata.json` (Credential Issuer Metadata), its `vct_metadata_uri#integrity`,
// and the placeholders left in each generated file.
export {
  EXTERNAL_URL_PLACEHOLDER,
  ISSUER_METADATA_FILE_NAME,
  ISSUER_METADATA_FORMAT,
  VCT_INTEGRITY_PLACEHOLDER,
  buildIssuerMetadata,
  filePlaceholders,
  serializeIssuerMetadata,
  servedTypeMetadataText,
  servedTypeMetadataUri,
  vctIntegrityCommand,
  vctMetadataIntegrity,
} from './export/issuerMetadata.ts';
export type {
  BuiltIssuerMetadata,
  ClaimDescription,
  CredentialConfigurationJson,
  CredentialDisplayEntry,
  FilePlaceholders,
  IssuerDisplayEntry,
  IssuerMetadataJson,
  MetadataLogo,
  MetadataPlaceholder,
} from './export/issuerMetadata.ts';

// Import: an existing bundle into a project.
export { importBundle } from './import/bundle.ts';
export { ImportError, parseJsonText } from './import/report.ts';
export type { ImportResult, ReportNote } from './import/report.ts';

export type OutputMode = "source" | "translation" | "bilingual";
export type JobKind = "transcribe" | "translate" | "render";
export type JobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled" | "attention";
export interface Word {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
}
export interface Translation {
  text: string;
  sourceRevision: number;
  provider: string;
}
export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  revision: number;
  speaker?: string;
  words?: Word[];
  translations: Record<string, Translation>;
}
export interface SubtitleDocument {
  schemaVersion: 1;
  revision: number;
  language: string;
  cues: Cue[];
}
export interface SubtitleStyle {
  font: string;
  fontSize: number;
  color: string;
  translationColor: string;
  outlineColor: string;
  outlineWidth: number;
  background: boolean;
  position: "bottom" | "top";
  margin: number;
  translationFirst: boolean;
}
export const defaultStyle: SubtitleStyle = {
  font: "Noto Sans CJK SC",
  fontSize: 48,
  color: "#ffffff",
  translationColor: "#a7f3d0",
  outlineColor: "#000000",
  outlineWidth: 2,
  background: false,
  position: "bottom",
  margin: 56,
  translationFirst: false,
};
export interface MediaInfo {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  audioCodec?: string;
  audioTracks: {
    index: number;
    language?: string;
    title?: string;
    codec?: string;
  }[];
}
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  media?: MediaInfo;
  mediaName?: string;
  document: SubtitleDocument;
  style: SubtitleStyle;
}
export interface Profile {
  id: string;
  name: string;
  provider: string;
  model: string;
  options: Record<string, string>;
  secrets: Record<string, string>;
  allowPrivateEndpoint: boolean;
  verification: "unverified" | "verified";
}
export interface PublicProfile extends Omit<Profile, "secrets"> {
  secretFields: string[];
}
export interface ProviderField {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
}
export interface ProviderDefinition {
  id: string;
  name: string;
  category: "asr" | "translation" | "storage";
  models: string[];
  input?: "file" | "url" | "s3" | "gcs";
  timestamps?: "word" | "segment" | "model";
  maxChunkSeconds?: number;
  fields: ProviderField[];
  docs: string;
  note?: string;
}
export interface Job {
  id: string;
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  phase: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  outputName?: string;
  params: JobParams;
}
export interface JobParams {
  profileId?: string;
  storageId?: string;
  language?: string;
  targetLanguage?: string;
  mode?: OutputMode;
  glossary?: string;
  audioTrack?: number;
  resolution?: number;
}
export interface Transcript {
  language: string;
  cues: Cue[];
  model?: string;
}
export interface AudioInput {
  path: string;
  durationMs: number;
  url?: string;
  objectUri?: string;
  requestId: string;
  language: string;
}
export type AsrSubmission =
  | { type: "complete"; transcript: Transcript }
  | { type: "pending"; id: string; context?: Record<string, string> };
export type AsrPoll = AsrSubmission | { type: "waiting" };
export interface AsrProvider {
  capabilities(): ProviderDefinition;
  submit(input: AudioInput): Promise<AsrSubmission>;
  poll(task: Extract<AsrSubmission, { type: "pending" }>): Promise<AsrPoll>;
}
export interface TranslationProvider {
  translate(
    cues: { id: string; text: string }[],
    source: string,
    target: string,
    context: string,
    glossary: string,
  ): Promise<Record<string, string>>;
}
export interface StagedObject {
  key: string;
  url: string;
  uri: string;
  expiresAt: number;
}
export interface StorageProvider {
  put(path: string, key: string): Promise<StagedObject>;
  remove(key: string): Promise<void>;
}
export interface MediaEngine {
  probe(path: string): Promise<MediaInfo>;
  extract(input: string, output: string, track: number): Promise<void>;
  render(
    input: string,
    output: string,
    document: SubtitleDocument,
    style: SubtitleStyle,
    params: JobParams,
  ): Promise<void>;
}
export interface AppState {
  projects: Project[];
  profiles: PublicProfile[];
  jobs: Job[];
}
export interface JobService {
  createJob(projectId: string, kind: JobKind, params: JobParams): Job;
  job(id: string): Job;
  jobs(): Job[];
  updateJob(id: string, patch: Partial<Job>): Job;
}
export interface Gateway {
  platform: "web" | "desktop" | "android";
  call<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;
  pickVideo(onProgress: (percent: number) => void): Promise<Project | null>;
  mediaUrl(projectId: string): string;
  outputUrl(jobId: string): string;
  saveText(name: string, text: string): Promise<void>;
}

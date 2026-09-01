import { z } from "zod";
export const styleSchema = z.object({
  font: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[^,\r\n]+$/),
  fontSize: z.number().min(12).max(160),
  color: z.string().regex(/^#[a-f0-9]{6}$/i),
  translationColor: z.string().regex(/^#[a-f0-9]{6}$/i),
  outlineColor: z.string().regex(/^#[a-f0-9]{6}$/i),
  outlineWidth: z.number().min(0).max(12),
  background: z.boolean(),
  position: z.enum(["bottom", "top"]),
  margin: z.number().min(0).max(500),
  translationFirst: z.boolean(),
});
export const profileSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(120),
  provider: z.string().max(80),
  model: z.string().max(200),
  options: z.record(z.string(), z.string().max(10000)),
  secrets: z.record(z.string(), z.string().max(50000)),
  allowPrivateEndpoint: z.boolean(),
});
export const jobParamsSchema = z.object({
  profileId: z.string().max(100).optional(),
  storageId: z.string().max(100).optional(),
  language: z.string().max(40).optional(),
  targetLanguage: z.string().max(40).optional(),
  mode: z.enum(["source", "translation", "bilingual"]).optional(),
  glossary: z.string().max(12000).optional(),
  audioTrack: z.number().int().min(0).max(32).optional(),
  resolution: z.number().int().min(240).max(4320).optional(),
  instruction: z.string().max(12000).optional(),
  scope: z.enum(["source", "translation"]).optional(),
  maxCharacters: z.number().int().min(4).max(200).optional(),
  maxDurationMs: z.number().int().min(500).max(30000).optional(),
  minCharacters: z.number().int().min(1).max(100).optional(),
});

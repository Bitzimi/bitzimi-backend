import { z } from "zod";

export const UploadDocumentSchema = z.object({
  dataUrl: z.string().min(1).refine(v => v.startsWith("data:"), "Must be a base64 data URL"),
});

export const SubmitKycBody = z.object({
  countryCode:  z.string().length(2),
  idType:       z.string().min(1),
  fullName:     z.string().min(2).max(128),
  dateOfBirth:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  address:      z.string().min(2).max(256),
  city:         z.string().min(1).max(100),
  state:        z.string().min(1).max(100),
  country:      z.string().min(1).max(100),
  postalCode:   z.string().min(1).max(20),
  frontDocKey:  z.string().min(1, "Front document must be uploaded first"),
  backDocKey:   z.string().optional(),
  selfieKey:    z.string().min(1, "Selfie must be uploaded first"),
  poaKey:       z.string().optional(),
});

export type SubmitKycInput    = z.infer<typeof SubmitKycBody>;
export type UploadDocumentInput = z.infer<typeof UploadDocumentSchema>;

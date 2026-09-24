import JSZip from 'jszip';
import { UserInputError } from '../pipeline/errors.js';

// Limits for an uploaded DOCX. A teacher's test is a few hundred KB; these
// bounds exist to stop zip bombs and pathological archives before anything
// is decompressed into memory.
export const DOCX_LIMITS = {
  maxEntries: 2000,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
  // Deflate rarely exceeds ~20:1 on XML; 200:1 on a part bigger than 1 MB is a bomb.
  maxCompressionRatio: 200,
  ratioCheckMinBytes: 1024 * 1024,
};

const MAIN_DOCUMENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const MACRO_DOCUMENT_TYPE = 'application/vnd.ms-word.document.macroEnabled.main+xml';
const TEMPLATE_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
];

export interface DocxPart {
  name: string;
  data: Uint8Array; // uncompressed bytes, exactly as in the upload
  date: Date;
}

export interface DocxPackage {
  parts: DocxPart[]; // archive order
  mainPartName: string; // normally word/document.xml
}

/** A file that is not a DOCX this tool can open. Mapped to HTTP 400. */
export class DocxRejectedError extends UserInputError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocxRejectedError';
    this.code = code;
  }
}

// jszip exposes sizes from the central directory only on an internal field.
interface JsZipEntryInternals {
  _data?: { uncompressedSize?: number; compressedSize?: number };
}

function isOleCompoundFile(buf: Uint8Array): boolean {
  return buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

function unsafeEntryName(name: string): boolean {
  return (
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some((seg) => seg === '..') ||
    /^[a-zA-Z]:/.test(name)
  );
}

/** Reads an entry with a hard byte limit (declared sizes can lie). */
async function readLimited(file: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    // internalStream is jszip's streaming API; it lets us stop mid-inflate.
    const stream = (file as unknown as { internalStream(t: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream(
      'uint8array'
    );
    stream
      .on('data', (chunk: Uint8Array) => {
        if (done) return;
        total += chunk.length;
        if (total > limit) {
          done = true;
          stream.pause();
          reject(
            new DocxRejectedError('too_large', `«${file.name}» մասը գերազանցում է թույլատրված չափը (${limit} բայթ):`)
          );
          return;
        }
        chunks.push(chunk);
      })
      .on('error', (err: Error) => {
        if (done) return;
        done = true;
        reject(new DocxRejectedError('corrupt', `Ֆայլը վնասված է («${file.name}»): ${err.message}`));
      })
      .on('end', () => {
        if (done) return;
        done = true;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        resolve(out);
      })
      .resume();
  });
}

export async function loadDocxPackage(buffer: Uint8Array): Promise<DocxPackage> {
  if (isOleCompoundFile(buffer)) {
    throw new DocxRejectedError(
      'ole_file',
      'Սա հին .doc ֆայլ է կամ գաղտնաբառով պաշտպանված DOCX: Աջակցվում է միայն Word-ում ստեղծված .docx առանց գաղտնաբառի:'
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch (err) {
    throw new DocxRejectedError('not_zip', `Ֆայլը DOCX չէ կամ վնասված է: ${err instanceof Error ? err.message : String(err)}`);
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > DOCX_LIMITS.maxEntries) {
    throw new DocxRejectedError('too_many_entries', `Ֆայլում չափազանց շատ մասեր կան (${entries.length} > ${DOCX_LIMITS.maxEntries}):`);
  }

  const seen = new Set<string>();
  let declaredTotal = 0;
  for (const f of entries) {
    // jszip silently normalises "../x" on load and keeps the raw name here.
    const rawName = (f as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ?? f.name;
    if (unsafeEntryName(rawName) || unsafeEntryName(f.name)) {
      throw new DocxRejectedError('unsafe_path', `Անթույլատրելի ուղի ֆայլի ներսում՝ «${rawName}»:`);
    }
    const key = f.name.toLowerCase();
    if (seen.has(key)) throw new DocxRejectedError('duplicate_entry', `Կրկնվող մաս՝ «${f.name}»:`);
    seen.add(key);

    const d = (f as unknown as JsZipEntryInternals)._data;
    const u = d?.uncompressedSize ?? 0;
    const c = d?.compressedSize ?? 0;
    if (u > DOCX_LIMITS.maxEntryUncompressedBytes) {
      throw new DocxRejectedError('too_large', `«${f.name}» մասը չափազանց մեծ է (${u} բայթ):`);
    }
    if (u >= DOCX_LIMITS.ratioCheckMinBytes && c > 0 && u / c > DOCX_LIMITS.maxCompressionRatio) {
      throw new DocxRejectedError('zip_bomb', `«${f.name}» մասի սեղմման հարաբերակցությունն անթույլատրելի է (${Math.round(u / c)}:1):`);
    }
    declaredTotal += u;
  }
  if (declaredTotal > DOCX_LIMITS.maxTotalUncompressedBytes) {
    throw new DocxRejectedError('too_large', `Ապասեղմված ընդհանուր չափը չափազանց մեծ է (${declaredTotal} բայթ):`);
  }

  const parts: DocxPart[] = [];
  let actualTotal = 0;
  for (const f of entries) {
    const data = await readLimited(f, DOCX_LIMITS.maxEntryUncompressedBytes);
    actualTotal += data.length;
    if (actualTotal > DOCX_LIMITS.maxTotalUncompressedBytes) {
      throw new DocxRejectedError('too_large', 'Ապասեղմված ընդհանուր չափը չափազանց մեծ է:');
    }
    parts.push({ name: f.name, data, date: f.date });
  }

  const ct = parts.find((p) => p.name === '[Content_Types].xml');
  if (!ct) throw new DocxRejectedError('not_docx', 'Ֆայլը DOCX չէ ([Content_Types].xml բացակայում է):');
  const ctXml = new TextDecoder('utf-8').decode(ct.data);

  if (ctXml.includes(MACRO_DOCUMENT_TYPE) || parts.some((p) => /vbaProject\.bin$/i.test(p.name))) {
    throw new DocxRejectedError('macro', 'Մակրոներով փաստաթղթերը (.docm) չեն աջակցվում:');
  }
  if (TEMPLATE_TYPES.some((t) => ctXml.includes(t))) {
    throw new DocxRejectedError('template', 'Word ձևանմուշները (.dotx) չեն աջակցվում. պահպանեք որպես .docx:');
  }

  const override = new RegExp(`PartName="/([^"]+)"\\s+ContentType="${MAIN_DOCUMENT_TYPE.replace(/[.+]/g, '\\$&')}"`);
  const overrideAlt = new RegExp(`ContentType="${MAIN_DOCUMENT_TYPE.replace(/[.+]/g, '\\$&')}"\\s+PartName="/([^"]+)"`);
  const m = override.exec(ctXml) || overrideAlt.exec(ctXml);
  if (!m) throw new DocxRejectedError('not_docx', 'Ֆայլը Word փաստաթուղթ չէ (հիմնական մասը չի գտնվել):');
  const mainPartName = decodeURIComponent(m[1]);
  if (!parts.some((p) => p.name === mainPartName)) {
    throw new DocxRejectedError('not_docx', `Հիմնական մասը «${mainPartName}» բացակայում է:`);
  }

  return { parts, mainPartName };
}

/**
 * Writes the package back. Every part is written from its bytes as given;
 * only parts listed in `replacements` differ. Archive order and entry dates
 * are kept.
 */
export async function writeDocxPackage(pkg: DocxPackage, replacements: Map<string, Uint8Array> = new Map()): Promise<Buffer> {
  const zip = new JSZip();
  for (const p of pkg.parts) {
    zip.file(p.name, replacements.get(p.name) ?? p.data, { date: p.date, binary: true, createFolders: false });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export function partText(part: DocxPart): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(part.data);
}

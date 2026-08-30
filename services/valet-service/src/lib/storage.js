import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Media storage behind one small interface, so routes never care where a file
 * physically lives.
 *
 * The prototype wrote files to a local directory and served them with
 * `res.sendFile`. That does not survive more than one service instance, so S3
 * is the default here. The local driver is kept for dev and tests, selected
 * with VALET_STORAGE=local (also the automatic choice when no bucket is
 * configured, so a fresh checkout runs without AWS credentials).
 */

const driverName = process.env.VALET_STORAGE || (process.env.VALET_S3_BUCKET ? 's3' : 'local');

// --- local driver -----------------------------------------------------------

const localRoot = path.resolve(process.env.VALET_UPLOAD_DIR || './uploads/valet');

const localDriver = {
  name: 'local',

  async put(key, body) {
    const dest = path.join(localRoot, key);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, body);
    return key;
  },

  async getStream(key) {
    const src = path.join(localRoot, key);
    if (!fs.existsSync(src)) return null;
    return fs.createReadStream(src);
  },

  async delete(key) {
    // Already gone is a success: the caller only wants the bytes absent.
    await fs.promises.unlink(path.join(localRoot, key)).catch(() => {});
  },
};

// --- s3 driver --------------------------------------------------------------
// Imported lazily so a local/dev run never pays for loading the AWS SDK, and
// so the tests (which always use the local driver) do not need it installed.

function makeS3Driver() {
  const bucket = process.env.VALET_S3_BUCKET;
  const region = process.env.AWS_REGION || 'ap-south-1';
  let clientPromise = null;

  async function client() {
    if (!clientPromise) {
      clientPromise = import('@aws-sdk/client-s3').then((m) => ({
        mod: m,
        s3: new m.S3Client({ region }),
      }));
    }
    return clientPromise;
  }

  return {
    name: 's3',

    async put(key, body, contentType) {
      const { mod, s3 } = await client();
      await s3.send(new mod.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }));
      return key;
    },

    async getStream(key) {
      const { mod, s3 } = await client();
      try {
        const out = await s3.send(new mod.GetObjectCommand({ Bucket: bucket, Key: key }));
        return out.Body;
      } catch (err) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async delete(key) {
      const { mod, s3 } = await client();
      await s3.send(new mod.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export const storage = driverName === 's3' ? makeS3Driver() : localDriver;

/**
 * Storage keys are prefixed by kind and ticket so a ticket's media can be
 * listed or lifecycle-ruled as a unit. The random suffix keeps two captures in
 * the same second from colliding.
 */
export function buildKey(kind, ticketId, extension) {
  return `valet/${kind}/${ticketId}/${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
}

export function extensionFor(mimetype) {
  if (/^image\/png/.test(mimetype)) return 'png';
  if (/^image\//.test(mimetype)) return 'jpg';
  if (/^video\/webm/.test(mimetype)) return 'webm';
  if (/^video\/mp4/.test(mimetype)) return 'mp4';
  return 'bin';
}

/**
 * @deprecated Use scripts/extract_pdf_collar_insignia.py instead.
 * Collar-device images are cropped from the ODS Knowledge Book PDF (pages 9–11).
 */
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const dir = dirname(fileURLToPath(import.meta.url))
const script = join(dir, 'extract_pdf_collar_insignia.py')
const result = spawnSync('python', [script], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
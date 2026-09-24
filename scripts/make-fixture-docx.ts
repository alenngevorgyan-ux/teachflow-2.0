// Builds the SYNTHETIC Armenian test used by the FIXTURE end-to-end run
// (docs/fixtures). Hand-written Word-shaped XML, not a real teacher's file.
import fs from 'fs';
import { NUMBERING_DECIMAL, buildDocx, numbered, para, run } from '../tests/docx/syntheticDocx.js';

const tab = '<w:r><w:tab/></w:r>';
const body =
  para(run('Թեստ՝ Ավարայրի ճակատամարտ', '<w:b/><w:sz w:val="32"/>')) +
  para(run('FIXTURE — սինթետիկ փորձնական նյութ, ոչ իրական ուսուցչի ֆայլ', '<w:i/>')) +
  para(run('Ընտրեք մեկ ճիշտ պատասխան:')) +
  numbered(run('Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:')) +
  para(run('ա) 451 թ.') + tab + run('բ) 301 թ.') + tab + run('գ) 387 թ.')) +
  numbered(run('Ո՞վ էր հայոց զորավարը Ավարայրի ճակատամարտում:')) +
  para(run('ա) Վարդան Մամիկոնյան')) +
  para(run('բ) Տիգրան Մեծ')) +
  para(run('գ) Արտաշես Առաջին')) +
  numbered(run('Համառոտ բացատրեք, թե ինչու է Ավարայրի ճակատամարտը կարևոր հայոց պատմության և մշակույթի համար:')) +
  para(run('ա) Պատասխանը գրեք 3–5 նախադասությամբ  բ) Օգտագործեք դասագրքի տերմինները')) +
  para(run('Պատասխաններ', '<w:b/>')) +
  para(run('1-ա, 2-գ'));

buildDocx({ body, numbering: NUMBERING_DECIMAL }).then((b) => {
  const out = process.argv[2] ?? 'docs/fixtures/synthetic-avarayr-test.docx';
  fs.writeFileSync(out, b);
  console.log(`wrote ${out} (${b.length} bytes)`);
});

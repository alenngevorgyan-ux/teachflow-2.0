// Seeds the separate, labelled FIXTURE environment used for the deterministic
// end-to-end UI run. It never touches the normal data/ store.
//
//   TEACHFLOW_DATA_DIR=.fixture-data npx tsx scripts/fixture-env.ts
//   PORT=3100 TEACHFLOW_DATA_DIR=.fixture-data TEACHFLOW_FIXTURE_MODE=1 MODEL_PROVIDER=fixture DISABLE_HMR=true npx tsx server.ts
//
// The sources below are SYNTHETIC test passages written for this fixture. They
// are not a real program, standard or textbook, and their "confirmation" is
// made by the setup script, not by a person.
import path from 'path';

async function main() {
  const dir = process.env.TEACHFLOW_DATA_DIR;
  if (!dir || path.resolve(dir) === path.resolve('data')) {
    console.error('Set TEACHFLOW_DATA_DIR to a separate directory (not data/).');
    process.exit(2);
  }
  const { repository } = await import('../server/store/repository.js');
  const { confirmSource, sourceContentHash } = await import('../server/pipeline/sourceConfirmation.js');
  type Source = Parameters<typeof repository.saveSource>[0];

  const subject = 'Հայոց պատմություն';
  const base = (id: string, o: Partial<Source>): Source => ({
    id,
    title: id,
    authority: 'FIXTURE (սինթետիկ, ոչ իրական մարմին)',
    docType: 'textbook',
    subject,
    grades: [7],
    role: 'FACT',
    version: 'fixture-1',
    effectiveFrom: '2026-09-01',
    status: 'active',
    sha256: `fixture-${id}`,
    isDemo: false,
    uploadedAt: new Date().toISOString(),
    chunks: [],
    ...o,
  });
  const confirm = (s: Source) =>
    confirmSource(s, { confirmedByName: 'fixture setup (ոչ մարդ)', expectedVersion: s.version, expectedContentHash: sourceContentHash(s) });

  const program = confirm(
    base('fixture-program-hp7', {
      title: 'FIXTURE — Հայոց պատմության ծրագիր, 7-րդ դաս. (սինթետիկ, ոչ իրական)',
      docType: 'subject_program',
      chunks: [{ id: 'fixture-program-hp7#p1#c1', sourceId: 'fixture-program-hp7', page: 1, text: 'Սովորողը բացատրում է Ավարայրի ճակատամարտի պատմական նշանակությունը:' }],
    })
  );
  const fact = confirm(
    base('fixture-fact-avarayr', {
      title: 'FIXTURE — Ավարայրի ճակատամարտ, փաստական հատված (սինթետիկ, ոչ իրական դասագիրք)',
      chunks: [
        {
          id: 'fixture-fact-avarayr#p12#c1',
          sourceId: 'fixture-fact-avarayr',
          page: 12,
          text: 'Ավարայրի ճակատամարտը տեղի է ունեցել 451 թվականին: Հայոց զորքը գլխավորում էր Վարդան Մամիկոնյանը:',
        },
      ],
    })
  );
  repository.saveSource(program);
  repository.saveSource(fact);
  repository.saveOutcomes([
    { code: 'FIXTURE-HP7-1', text: 'Ավարայրի ճակատամարտի պատմական նշանակությունը', subject, grade: 7, standardVersion: 'fixture-1', sourceId: program.id, confirmed: true },
  ]);
  console.log(`FIXTURE store ready in ${path.resolve(dir)}: ${program.id}, ${fact.id}`);
}

main();

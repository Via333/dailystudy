import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
const source = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const output = (file) => source(`dist/${file}`);
const json = async (file) => JSON.parse(await source(file));

test('两个身份是独立可直接访问的静态页面，课程导航保留身份', async () => {
  const config = await json('config/identities.json');
  const home = await output('index.html');
  for (const identity of config.identities) {
    const html = await output(`${identity.path}/index.html`);
    assert.ok(home.includes(`href="./${identity.path}/"`));
    assert.ok(html.includes(`<h1>${identity.title}</h1>`));
    assert.ok(html.includes(`data-learning-identity="${identity.id}"`));
    for (const id of ['identity-focus', 'identity-curriculum','identity-plan','identity-history']) assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes('发布进度不等于你的学习完成度'));
    assert.ok(html.includes('每天 1–2 课'));
    assert.ok(html.includes('未发布的内容不计进度'));
    const modules = [...new Set([...identity.primaryModules,...identity.foundationModules])];
    for (const module of modules) {
      assert.ok(html.includes(`href="./curriculum/${module}/"`));
      const track = await output(`${identity.path}/curriculum/${module}/index.html`);
      assert.ok(track.includes(`<title>`));
      assert.ok(track.includes(`href="../../../${identity.path}/"`));
      assert.ok(track.includes(`href="../../../${identity.path}/curriculum/${module}/"`));
      assert.ok(track.includes('用上方身份练习替换原练习'));
      assert.ok(track.includes(identity.contexts[module].caseContext));
      assert.ok(track.includes(identity.contexts[module].exercise));
      assert.ok(track.includes('共用知识树发布进度'));
    }
  }
  const personal = await output('personal/index.html');
  const work = await output('career/index.html');
  assert.ok(personal.includes('投资'));
  assert.ok(personal.includes('海外') || personal.includes('出海'));
  assert.ok(work.includes('DTC'));
  assert.ok(work.includes('归因'));
  assert.ok(work.includes('CRM'));
});

test('身份页面发布数只来自真实标签，不将旧档或起步课双重计数', async () => {
  const config = await json('config/identities.json');
  const progress = JSON.parse(await output('content/identity-progress.json'));
  const archive = JSON.parse(await output('content/archive.json'));
  assert.equal(progress.effectiveDate, config.effectiveDate);
  for (const identity of config.identities) {
    const actual = archive.filter(entry => entry.date >= config.effectiveDate).flatMap(entry => entry.lessons).filter(lesson => lesson.learningIdentity === identity.id).length;
    assert.equal(progress.identities.find(item => item.id === identity.id).publishedLessons,actual);
  }
  for (const entry of archive.filter(item => item.date < config.effectiveDate)) for (const lesson of entry.lessons) assert.equal(lesson.learningIdentity,null);
});

test('迁移保留三个旧日期归档、13节原起步课与344单元知识树的原始字节', async () => {
  const hashes = {
    'content/daily/2026-08-08.json':'a9a13d491dd2bf2ff77f20a6c8c70827afe7b8757908a6d83f8509d8a1ecd913',
    'content/daily/2026-10-02.json':'c08c421280fbec89853e847557211d19e626d383580a70b2d3a40e3ebe4a46d9',
    'content/daily/2026-10-03.json':'cda4cf38d6d27c326519533ea8258d09f39c3502ac1f6702c677057f493af782',
    'content/starter-lessons.json':'23c8b660fbe5d80f0702aaa1e24bf531b5501a9a4688421f2383398dd8442439',
    'config/curriculum.json':'382ed34131fb619c5eb99bd7eb53fc06d31eefed4865cbe980682b509c515141'
  };
  for (const [file,hash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(await source(file)).digest('hex'),hash,file);
});

test('未来双身份一期生成各自日期页，链接和课程内容不会串线', async () => {
  const { cp, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { execFileSync } = await import('node:child_process');
  const root = fileURLToPath(new URL('../',import.meta.url));
  const temporary = await mkdtemp(path.join(tmpdir(),'daily-identities-'));
  try {
    for (const directory of ['config','content','scripts','site']) await cp(path.join(root,directory),path.join(temporary,directory),{recursive:true});
    const config = await json('config/identities.json');
    const { identityPlanForDate } = await import('../scripts/identities.mjs');
    const { readDailyEntries } = await import('../scripts/lib.mjs');
    const entries = await readDailyEntries();
    const topics = await json('config/topics.json');
    const curriculum = await json('config/curriculum.json');
    const starters = await json('content/starter-lessons.json');
    const plan = identityPlanForDate('2026-10-04',topics,curriculum,entries,config);
    assert.equal(new Set(plan.map(item=>item.learningIdentity)).size,2);
    const fixture = structuredClone(entries[0]);
    fixture.date = '2026-10-04';
    fixture.estimatedMinutes = 36;
    fixture.lessons = plan.map(({module,unit,cycle,learningIdentity}) => ({
      ...structuredClone(starters.lessons.find(item=>item.module===module)),
      learningIdentity, estimatedMinutes:16,
      curriculum:{stageId:unit.stageId,stageTitle:unit.stageTitle,unitId:unit.id,unitTitle:unit.title,objective:unit.objective,scope:unit.scope,sequence:unit.sequence,totalUnits:unit.totalUnits,cycle}
    }));
    fixture.radar[0].estimatedMinutes = 4;
    await writeFile(path.join(temporary,'content/daily/2026-10-04.json'),JSON.stringify(fixture));
    execFileSync(process.execPath,['scripts/validate-content.mjs'],{cwd:temporary,encoding:'utf8'});
    execFileSync(process.execPath,['scripts/build-site.mjs'],{cwd:temporary,encoding:'utf8',env:{...process.env,SITE_URL:'https://via333.github.io/dailystudy/'}});
    const buildAtFixtureDate = `const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-04T12:00:00Z'])); } static now() { return RealDate.parse('2026-10-04T12:00:00Z'); } }; await import('./scripts/build-site.mjs');`;
    execFileSync(process.execPath,['--input-type=module','--eval',buildAtFixtureDate],{cwd:temporary,encoding:'utf8',env:{...process.env,SITE_URL:'https://via333.github.io/dailystudy/'}});
    const sitemap = await readFile(path.join(temporary,'dist/sitemap.xml'),'utf8');
    for (const identity of config.identities) {
      const html = await readFile(path.join(temporary,`dist/${identity.path}/daily/2026-10-04/index.html`),'utf8');
      const own = fixture.lessons.filter(item=>item.learningIdentity===identity.id);
      const other = fixture.lessons.filter(item=>item.learningIdentity!==identity.id);
      for (const lesson of own) {
        assert.ok(html.includes(lesson.coreQuestion));
        assert.ok(html.includes(`href="../../../${identity.path}/curriculum/${lesson.module}/"`));
      }
      for (const lesson of other) assert.ok(!html.includes(lesson.coreQuestion));
      assert.ok(sitemap.includes(`/dailystudy/${identity.path}/daily/2026-10-04/`));
      const home = await readFile(path.join(temporary,`dist/${identity.path}/index.html`),'utf8');
      assert.ok(home.includes(`href="./daily/2026-10-04/#${own[0].id}"`));
    }
  } finally { await rm(temporary,{recursive:true,force:true}); }
});

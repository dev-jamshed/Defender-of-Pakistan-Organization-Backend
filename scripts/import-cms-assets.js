const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..', '..');
const contentRoot = path.join(root, 'assets and instructions', 'Defenders_of_Pakistan_Website_Content');
const dbPath = path.join(root, 'server', 'data', 'dpo.sqlite');
const now = new Date().toISOString();

function read(relativePath) {
  const filePath = path.join(contentRoot, ...relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
}

function record(id, slug, titleEnglish, type, content, status = 'published') {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    slug,
    type,
    titleEnglish,
    titleUrdu: '',
    seoTitle: `${titleEnglish} | Defenders of Pakistan Organization`,
    status,
    language: 'EN',
    source: 'assets and instructions',
    content,
  };
}

const heroSlides = [
  '/dpo-assets/front-1.png',
  '/dpo-assets/front-2.png',
  '/dpo-assets/front-3.png',
  '/dpo-assets/front-4.png',
];

const mediaAssets = [
  '/dpo-assets/logo-transparent.png',
  '/dpo-assets/logo.png',
  '/dpo-assets/logo.svg',
  '/favicon.ico',
  ...heroSlides,
  '/dpo-assets/cms/membership.png',
  '/dpo-assets/cms/designation.png',
  '/dpo-assets/cms/designation-empty.png',
  '/dpo-assets/cms/designation-idea.png',
  '/dpo-assets/cms/card-logo.png',
  '/dpo-assets/cms/renewal-section.png',
  '/dpo-assets/cms/legal-handbook.pdf',
  '/dpo-assets/cms/legal-handbook.docx',
];

const organizationDetails = read(['01_Organization_Details', 'organization_details.txt']);
const aboutDetails = read(['04_About_Mission_Vision', 'ABOUT DETA.txt']);
const actionPlan = read(['04_About_Mission_Vision', 'action plan.txt']);
const membershipUrdu = read(['05_Membership_Details', 'membership_details_اردو.txt']);
const designationEnglish = read(['06_Designation_Details', 'detail about deignation.txt']);
const designationUrdu = read(['06_Designation_Details', 'designation_details_اردو.txt']);
const cardRequirementsUrdu = read(['07_Card_Design', 'membership_card_requirements_اردو.txt']);
const galleryGuidelinesUrdu = read(['08_Gallery_Content', 'gallery_guidelines_اردو.txt']);

const records = [
  record('cms_home', 'home', 'Defenders of Pakistan Organization', 'landing', {
    logo: '/dpo-assets/logo-transparent.png',
    favicon: '/favicon.ico',
    heroSlides,
    organizationDetails,
    aboutDetails,
    actionPlan,
    mediaAssets,
  }),
  record('cms_about_dpo', 'about-dpo', 'About DPO', 'standard', {
    body: aboutDetails,
    sections: ['About Us', 'Mission', 'Vision', 'Core Values'],
  }),
  record('cms_action_plan', 'action-plan', '7-Point National Action Plan', 'standard', {
    body: actionPlan,
  }),
  record('cms_membership_details', 'membership-details', 'Membership Details', 'standard', {
    bodyUrdu: membershipUrdu,
    assets: ['/dpo-assets/cms/membership.png'],
  }),
  record('cms_designation_details', 'designation-details', 'Designation Details', 'standard', {
    bodyEnglish: designationEnglish,
    bodyUrdu: designationUrdu,
    assets: [
      '/dpo-assets/cms/designation.png',
      '/dpo-assets/cms/designation-empty.png',
      '/dpo-assets/cms/designation-idea.png',
    ],
  }),
  record('cms_card_design', 'card-design', 'Membership Card Design Requirements', 'standard', {
    bodyUrdu: cardRequirementsUrdu,
    assets: [
      '/dpo-assets/cms/card-logo.png',
      '/dpo-assets/logo-transparent.png',
      '/dpo-assets/logo.png',
    ],
  }),
  record('cms_gallery_guidelines', 'gallery-guidelines', 'Gallery Guidelines', 'standard', {
    bodyUrdu: galleryGuidelinesUrdu,
  }),
  record('cms_legal_policy', 'legal-policy-handbook', 'Legal and Policy Handbook', 'legal', {
    documents: [
      '/dpo-assets/cms/legal-handbook.pdf',
      '/dpo-assets/cms/legal-handbook.docx',
    ],
  }),
  record('cms_renewal_section', 'renewal-section', 'Membership Renewal Section', 'standard', {
    assets: ['/dpo-assets/cms/renewal-section.png'],
  }),
  record('cms_media_library', 'media-library', 'Media Library', 'media', {
    assets: mediaAssets,
  }),
];

const db = new Database(dbPath);
const stmt = db.prepare(`
  INSERT INTO DpoRecord (id, resource, status, dataJson, createdAt, updatedAt)
  VALUES (@id, 'cms-pages', @status, @dataJson, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    resource = 'cms-pages',
    status = excluded.status,
    dataJson = excluded.dataJson,
    updatedAt = excluded.updatedAt
`);

const tx = db.transaction((items) => {
  for (const item of items) {
    stmt.run({
      id: item.id,
      status: item.status,
      dataJson: JSON.stringify(item),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
});

tx(records);
db.close();

console.log(`Imported ${records.length} CMS records from assets into ${dbPath}`);

import { getTenantDb } from '../src/services/tenantDb.service.js';
import { generateBrandedPdfBuffer } from '../src/services/pdfGenerator.service.js';
import { resolveOrgPdfLogoDataUri } from '../src/utils/pdfLogo.js';

async function testPdfGeneration() {
  console.log('Testing PDF generation with BUG-007 fields...');
  const tenantDb = getTenantDb('epic_technoweb');
  const org = await tenantDb.Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;

  const mockApplication = {
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice.smith@example.com',
    contactNumber: '+44 7123 456789',
    applicationType: 'Single',
    gender: 'Female',
    relationshipStatus: 'Single',
    address: '100 Queensway, London, W2 3RX',
    addressStartDate: '2021-04-12',
    housingStatus: 'Rent',
    landlordName: 'London Living Properties Ltd',
    landlordContactNumber: '+44 20 7946 0991',
    landlordEmail: 'lettings@londonliving.co.uk',
    landlordAddress: '50 Kensington High Street, London, W8 4ED',
    nationality: 'British',
    status: 'draft',
    createdAt: new Date(),
  };

  const PDF_APPLICATION_SECTIONS = [
    {
      title: 'Personal Information',
      fields: [
        'firstName', 'lastName', 'email', 'contactNumber', 'contactNumber2',
        'applicationType', 'gender', 'relationshipStatus', 'address',
        'addressStartDate', 'housingStatus', 'landlordName', 'landlordContactNumber', 'landlordEmail', 'landlordAddress',
        'previousFullAddress', 'previousAddress', 'startDate', 'endDate',
      ],
    },
    {
      title: 'Nationality & Birth',
      fields: ['nationality', 'birthCountry', 'placeOfBirth', 'dob'],
    },
  ];

  const logoDataUri = await resolveOrgPdfLogoDataUri(tenantDb, orgId);

  const sectionsForPdf = PDF_APPLICATION_SECTIONS.map((sec) => ({
    title: sec.title,
    fields: sec.fields.map((f) => ({
      label: f,
      value: mockApplication[f] || '—',
    })),
  }));

  const subtitle = `Applicant: ${mockApplication.firstName} ${mockApplication.lastName} · Application ID: APP-12345`;
  const pdfBuffer = await generateBrandedPdfBuffer({
    title: 'Candidate Application Summary',
    subtitle,
    sections: sectionsForPdf,
    logoDataUri,
    orgName: org?.name || 'Immigration CRM',
  });

  if (!pdfBuffer || pdfBuffer.length < 500) {
    throw new Error('FAIL: PDF buffer was not generated or too small');
  }

  console.log(`[PASS] PDF generated successfully! Buffer size: ${pdfBuffer.length} bytes`);
  process.exit(0);
}

testPdfGeneration().catch((err) => {
  console.error('PDF Generation Test Failed:', err);
  process.exit(1);
});

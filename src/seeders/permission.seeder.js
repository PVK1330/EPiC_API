import db from '../models/index.js';

const { Permission, Role, RolePermission } = db;

const PERMISSIONS_DATA = [
  // ==================== ADMIN PANEL MODULES ====================
  
  // Dashboard Module
  { name: 'admin.dashboard.view', description: 'View admin dashboard', module: 'dashboard', action: 'view', resource: 'admin' },
  
  // User Management Module
  { name: 'admin.users.view', description: 'View all users', module: 'user_management', action: 'view', resource: 'users' },
  { name: 'admin.users.create', description: 'Create users', module: 'user_management', action: 'create', resource: 'users' },
  { name: 'admin.users.update', description: 'Update users', module: 'user_management', action: 'update', resource: 'users' },
  { name: 'admin.users.delete', description: 'Delete users', module: 'user_management', action: 'delete', resource: 'users' },
  { name: 'admin.users.reset_password', description: 'Reset user passwords', module: 'user_management', action: 'reset_password', resource: 'users' },
  { name: 'admin.users.toggle_status', description: 'Toggle user status', module: 'user_management', action: 'toggle_status', resource: 'users' },
  
  // Admin Users Specific
  { name: 'admin.admin_users.view', description: 'View admin users', module: 'admin_users', action: 'view', resource: 'users' },
  { name: 'admin.admin_users.create', description: 'Create admin users', module: 'admin_users', action: 'create', resource: 'users' },
  { name: 'admin.admin_users.update', description: 'Update admin users', module: 'admin_users', action: 'update', resource: 'users' },
  { name: 'admin.admin_users.delete', description: 'Delete admin users', module: 'admin_users', action: 'delete', resource: 'users' },
  
  // Caseworker Users Specific
  { name: 'admin.caseworkers.view', description: 'View caseworkers', module: 'caseworkers', action: 'view', resource: 'users' },
  { name: 'admin.caseworkers.create', description: 'Create caseworkers', module: 'caseworkers', action: 'create', resource: 'users' },
  { name: 'admin.caseworkers.update', description: 'Update caseworkers', module: 'caseworkers', action: 'update', resource: 'users' },
  { name: 'admin.caseworkers.delete', description: 'Delete caseworkers', module: 'caseworkers', action: 'delete', resource: 'users' },
  
  // Candidate Users Specific
  { name: 'admin.candidates.view', description: 'View candidates', module: 'candidates', action: 'view', resource: 'users' },
  { name: 'admin.candidates.create', description: 'Create candidates', module: 'candidates', action: 'create', resource: 'users' },
  { name: 'admin.candidates.update', description: 'Update candidates', module: 'candidates', action: 'update', resource: 'users' },
  { name: 'admin.candidates.delete', description: 'Delete candidates', module: 'candidates', action: 'delete', resource: 'users' },
  
  // Sponsor/Business Users Specific
  { name: 'admin.sponsors.view', description: 'View sponsors/businesses', module: 'sponsors', action: 'view', resource: 'users' },
  { name: 'admin.sponsors.create', description: 'Create sponsors/businesses', module: 'sponsors', action: 'create', resource: 'users' },
  { name: 'admin.sponsors.update', description: 'Update sponsors/businesses', module: 'sponsors', action: 'update', resource: 'users' },
  { name: 'admin.sponsors.delete', description: 'Delete sponsors/businesses', module: 'sponsors', action: 'delete', resource: 'users' },
  
  // Access Control Module
  { name: 'admin.permissions.view', description: 'View permissions', module: 'access_control', action: 'view', resource: 'permissions' },
  { name: 'admin.permissions.manage', description: 'Manage permissions', module: 'access_control', action: 'manage', resource: 'permissions' },
  { name: 'admin.rbac.view', description: 'View RBAC matrix', module: 'access_control', action: 'view_rbac', resource: 'rbac' },
  { name: 'admin.rbac.manage', description: 'Manage RBAC', module: 'access_control', action: 'manage_rbac', resource: 'rbac' },
  
  // Case Management Module
  { name: 'admin.cases.view', description: 'View all cases', module: 'case_management', action: 'view', resource: 'cases' },
  { name: 'admin.cases.create', description: 'Create cases', module: 'case_management', action: 'create', resource: 'cases' },
  { name: 'admin.cases.update', description: 'Update cases', module: 'case_management', action: 'update', resource: 'cases' },
  { name: 'admin.cases.delete', description: 'Delete cases', module: 'case_management', action: 'delete', resource: 'cases' },
  { name: 'admin.cases.detail', description: 'View case details', module: 'case_management', action: 'detail', resource: 'cases' },
  { name: 'admin.cases.assign', description: 'Assign cases', module: 'case_management', action: 'assign', resource: 'cases' },
  { name: 'admin.cases.reassign', description: 'Reassign cases', module: 'case_management', action: 'reassign', resource: 'cases' },
  { name: 'admin.cases.pipeline', description: 'View pipeline', module: 'case_management', action: 'pipeline', resource: 'cases' },
  { name: 'admin.escalations.view', description: 'View escalations', module: 'case_management', action: 'view_escalations', resource: 'escalations' },
  { name: 'admin.escalations.manage', description: 'Manage escalations', module: 'case_management', action: 'manage_escalations', resource: 'escalations' },
  
  // Team Module
  { name: 'admin.team.workload', description: 'View workload monitoring', module: 'team', action: 'workload', resource: 'team' },
  
  // Finance Module
  { name: 'admin.finance.view', description: 'View finance & payments', module: 'finance', action: 'view', resource: 'finance' },
  { name: 'admin.finance.manage', description: 'Manage finance & payments', module: 'finance', action: 'manage', resource: 'finance' },
  
  // Reports Module
  { name: 'admin.reports.view', description: 'View reports', module: 'reports', action: 'view', resource: 'reports' },
  { name: 'admin.reports.analytics', description: 'View analytics', module: 'reports', action: 'analytics', resource: 'reports' },
  { name: 'admin.reports.export', description: 'Export reports', module: 'reports', action: 'export', resource: 'reports' },
  
  // Tools Module
  { name: 'admin.notifications.view', description: 'View notifications', module: 'tools', action: 'view_notifications', resource: 'tools' },
  { name: 'admin.notifications.manage', description: 'Manage notifications', module: 'tools', action: 'manage_notifications', resource: 'tools' },
  { name: 'admin.messages.view', description: 'View messages', module: 'tools', action: 'view_messages', resource: 'tools' },
  { name: 'admin.messages.manage', description: 'Manage messages', module: 'tools', action: 'manage_messages', resource: 'tools' },
  { name: 'admin.audit.view', description: 'View compliance & audits', module: 'tools', action: 'view_audit', resource: 'audit' },
  { name: 'admin.settings.view', description: 'View settings', module: 'tools', action: 'view_settings', resource: 'settings' },
  { name: 'admin.settings.manage', description: 'Manage settings', module: 'tools', action: 'manage_settings', resource: 'settings' },

  // ==================== BUSINESS PANEL MODULES ====================
  
  // Business Dashboard
  { name: 'business.dashboard.view', description: 'View business dashboard', module: 'dashboard', action: 'view', resource: 'business' },
  
  // Organisation Module
  { name: 'business.profile.view', description: 'View business profile', module: 'organisation', action: 'view_profile', resource: 'organisation' },
  { name: 'business.profile.update', description: 'Update business profile', module: 'organisation', action: 'update_profile', resource: 'organisation' },
  { name: 'business.personnel.view', description: 'View key personnel', module: 'organisation', action: 'view_personnel', resource: 'organisation' },
  { name: 'business.personnel.manage', description: 'Manage key personnel', module: 'organisation', action: 'manage_personnel', resource: 'organisation' },
  
  // Sponsorship Module
  { name: 'business.licence.view', description: 'View licence status', module: 'sponsorship', action: 'view_licence', resource: 'licence' },
  { name: 'business.licence.apply', description: 'Apply/renew licence', module: 'sponsorship', action: 'apply_licence', resource: 'licence' },
  { name: 'business.licence.documents', description: 'View licence documents', module: 'sponsorship', action: 'view_licence_docs', resource: 'licence' },
  { name: 'business.cos.view', description: 'View CoS allocation', module: 'sponsorship', action: 'view_cos', resource: 'cos' },
  { name: 'business.cos.manage', description: 'Manage CoS allocation', module: 'sponsorship', action: 'manage_cos', resource: 'cos' },
  { name: 'business.workers.view', description: 'View sponsored workers', module: 'sponsorship', action: 'view_workers', resource: 'workers' },
  { name: 'business.workers.manage', description: 'Manage sponsored workers', module: 'sponsorship', action: 'manage_workers', resource: 'workers' },
  
  // Candidates Module
  { name: 'business.candidates.view', description: 'View my candidates', module: 'candidates', action: 'view', resource: 'candidates' },
  { name: 'business.candidates.manage', description: 'Manage candidates', module: 'candidates', action: 'manage', resource: 'candidates' },
  
  // Compliance Module
  { name: 'business.compliance.view', description: 'View compliance dashboard', module: 'compliance', action: 'view_dashboard', resource: 'compliance' },
  { name: 'business.compliance.documents', description: 'View compliance documents', module: 'compliance', action: 'view_documents', resource: 'compliance' },
  { name: 'business.compliance.reporting', description: 'View reporting obligations', module: 'compliance', action: 'view_reporting', resource: 'compliance' },
  
  // HR File Management
  { name: 'business.hr.view', description: 'View employee records', module: 'hr', action: 'view', resource: 'hr' },
  { name: 'business.hr.manage', description: 'Manage employee records', module: 'hr', action: 'manage', resource: 'hr' },
  
  // Business Finance
  { name: 'business.finance.invoices', description: 'View invoices', module: 'finance', action: 'view_invoices', resource: 'finance' },
  { name: 'business.finance.payments', description: 'View payments', module: 'finance', action: 'view_payments', resource: 'finance' },
  { name: 'business.finance.manage', description: 'Manage finance', module: 'finance', action: 'manage', resource: 'finance' },
  
  // Communication
  { name: 'business.messages.view', description: 'View messages', module: 'communication', action: 'view_messages', resource: 'communication' },
  { name: 'business.messages.send', description: 'Send messages', module: 'communication', action: 'send_messages', resource: 'communication' },
  { name: 'business.notifications.view', description: 'View notifications', module: 'communication', action: 'view_notifications', resource: 'communication' },
  
  // Business Reports
  { name: 'business.reports.view', description: 'View reports', module: 'reports', action: 'view', resource: 'reports' },
  
  // Business Settings
  { name: 'business.settings.view', description: 'View settings', module: 'settings', action: 'view', resource: 'settings' },
  { name: 'business.settings.update', description: 'Update settings', module: 'settings', action: 'update', resource: 'settings' },

  // ==================== CASEWORKER PANEL MODULES ====================
  
  // Caseworker Dashboard
  { name: 'caseworker.dashboard.view', description: 'View caseworker dashboard', module: 'dashboard', action: 'view', resource: 'caseworker' },
  
  // Cases Module
  { name: 'caseworker.cases.view', description: 'View assigned cases', module: 'cases', action: 'view', resource: 'cases' },
  { name: 'caseworker.cases.update', description: 'Update cases', module: 'cases', action: 'update', resource: 'cases' },
  { name: 'caseworker.cases.detail', description: 'View case details', module: 'cases', action: 'detail', resource: 'cases' },
  
  // Workflow Module
  { name: 'caseworker.pipeline.view', description: 'View pipeline', module: 'workflow', action: 'view_pipeline', resource: 'pipeline' },
  { name: 'caseworker.tasks.view', description: 'View tasks', module: 'workflow', action: 'view_tasks', resource: 'tasks' },
  { name: 'caseworker.tasks.manage', description: 'Manage tasks', module: 'workflow', action: 'manage_tasks', resource: 'tasks' },
  { name: 'caseworker.calendar.view', description: 'View calendar', module: 'workflow', action: 'view_calendar', resource: 'calendar' },
  { name: 'caseworker.calendar.manage', description: 'Manage calendar', module: 'workflow', action: 'manage_calendar', resource: 'calendar' },
  
  // Documents Module
  { name: 'caseworker.documents.upload', description: 'Upload documents', module: 'documents', action: 'upload', resource: 'documents' },
  { name: 'caseworker.documents.view', description: 'View documents', module: 'documents', action: 'view', resource: 'documents' },
  
  // People Module
  { name: 'caseworker.sponsors.view', description: 'View sponsor profiles', module: 'people', action: 'view_sponsors', resource: 'people' },
  { name: 'caseworker.candidates.view', description: 'View candidate profiles', module: 'people', action: 'view_candidates', resource: 'people' },
  
  // Other Module
  { name: 'caseworker.messages.view', description: 'View messages', module: 'other', action: 'view_messages', resource: 'other' },
  { name: 'caseworker.performance.view', description: 'View performance', module: 'other', action: 'view_performance', resource: 'other' },
  
  // Account Module
  { name: 'caseworker.account.view', description: 'View my account', module: 'account', action: 'view', resource: 'account' },
  { name: 'caseworker.account.update', description: 'Update my account', module: 'account', action: 'update', resource: 'account' },
  { name: 'caseworker.reschedule.view', description: 'View reschedule form', module: 'account', action: 'view_reschedule', resource: 'account' },

  // ==================== CANDIDATE PANEL MODULES ====================
  
  // Candidate Dashboard
  { name: 'candidate.dashboard.view', description: 'View candidate dashboard', module: 'dashboard', action: 'view', resource: 'candidate' },
  
  // Application Module
  { name: 'candidate.application.view', description: 'View application form', module: 'application', action: 'view', resource: 'application' },
  { name: 'candidate.application.submit', description: 'Submit application', module: 'application', action: 'submit', resource: 'application' },
  { name: 'candidate.application.update', description: 'Update application', module: 'application', action: 'update', resource: 'application' },
  
  // Documents Module
  { name: 'candidate.documents.checklist', description: 'View document checklist', module: 'documents', action: 'view_checklist', resource: 'documents' },
  { name: 'candidate.documents.upload', description: 'Upload documents', module: 'documents', action: 'upload', resource: 'documents' },
  { name: 'candidate.documents.view', description: 'View documents', module: 'documents', action: 'view', resource: 'documents' },
  
  // Case Tracking Module
  { name: 'candidate.status.view', description: 'View application status', module: 'case_tracking', action: 'view_status', resource: 'status' },
  
  // Communication Module
  { name: 'candidate.messages.view', description: 'View messages', module: 'communication', action: 'view_messages', resource: 'communication' },
  { name: 'candidate.messages.send', description: 'Send messages', module: 'communication', action: 'send_messages', resource: 'communication' },
  { name: 'candidate.notifications.view', description: 'View notifications', module: 'communication', action: 'view_notifications', resource: 'communication' },
  
  // Appointments Module
  { name: 'candidate.appointments.view', description: 'View appointments', module: 'appointments', action: 'view', resource: 'appointments' },
  { name: 'candidate.appointments.manage', description: 'Manage appointments', module: 'appointments', action: 'manage', resource: 'appointments' },
  
  // Payments Module
  { name: 'candidate.payments.view', description: 'View payment summary', module: 'payments', action: 'view', resource: 'payments' },
  { name: 'candidate.payments.history', description: 'View payment history', module: 'payments', action: 'history', resource: 'payments' },
  
  // Downloads Module
  { name: 'candidate.downloads.view', description: 'View application pack', module: 'downloads', action: 'view', resource: 'downloads' },
  
  // Account Module
  { name: 'candidate.account.view', description: 'View profile & settings', module: 'account', action: 'view', resource: 'account' },
  { name: 'candidate.account.update', description: 'Update profile & settings', module: 'account', action: 'update', resource: 'account' },
  { name: 'candidate.feedback.view', description: 'View feedback', module: 'account', action: 'view_feedback', resource: 'account' },
  { name: 'candidate.feedback.submit', description: 'Submit feedback', module: 'account', action: 'submit_feedback', resource: 'account' },
];

const ROLE_PERMISSIONS = {
  1: 'admin', // Admin role - all permissions
  2: 'caseworker', // Caseworker role - case, escalation, reports
  3: 'candidate', // Candidate role - view own data
  4: 'sponsor', // Sponsor/Business role - case, payment, reports
};

const getCaseworkerPermissions = () => {
  return PERMISSIONS_DATA
    .filter(p => 
      p.module === 'dashboard' ||
      p.module === 'cases' ||
      p.module === 'workflow' ||
      p.module === 'documents' ||
      p.module === 'people' ||
      p.module === 'other' ||
      p.module === 'account'
    )
    .map(p => p.name);
};

const getSponsorPermissions = () => {
  return PERMISSIONS_DATA
    .filter(p => 
      p.resource === 'business' ||
      p.module === 'organisation' ||
      p.module === 'sponsorship' ||
      p.module === 'candidates' ||
      p.module === 'compliance' ||
      p.module === 'hr' ||
      (p.module === 'finance' && p.resource === 'finance') ||
      p.module === 'communication' ||
      (p.module === 'reports' && p.resource === 'reports') ||
      (p.module === 'settings' && p.resource === 'settings')
    )
    .map(p => p.name);
};

const getCandidatePermissions = () => {
  return PERMISSIONS_DATA
    .filter(p => 
      p.resource === 'candidate' ||
      p.module === 'application' ||
      p.module === 'documents' ||
      p.module === 'case_tracking' ||
      p.module === 'communication' ||
      p.module === 'appointments' ||
      p.module === 'payments' ||
      p.module === 'downloads' ||
      p.module === 'account'
    )
    .map(p => p.name);
};

const seedPermissions = async () => {
  try {
    console.log('Seeding permissions...');

    // Create all permissions
    for (const permData of PERMISSIONS_DATA) {
      await Permission.findOrCreate({
        where: { name: permData.name },
        defaults: permData,
      });
    }

    console.log('Permissions seeded successfully');
  } catch (error) {
    console.error('Error seeding permissions:', error);
    throw error;
  }
};

const seedRolePermissions = async () => {
  try {
    console.log('Seeding role permissions...');

    // Get all roles
    const roles = await Role.findAll();
    const allPermissions = await Permission.findAll();

    // Admin (role_id: 1) - All permissions
    const adminRole = roles.find(r => r.id === 1);
    if (adminRole) {
      await adminRole.setPermissions(allPermissions);
      console.log('Admin role assigned all permissions');
    }

    // Caseworker (role_id: 2) - Case, Escalation, Reports
    const caseworkerRole = roles.find(r => r.id === 2);
    if (caseworkerRole) {
      const caseworkerPermNames = getCaseworkerPermissions();
      const caseworkerPerms = allPermissions.filter(p => caseworkerPermNames.includes(p.name));
      await caseworkerRole.setPermissions(caseworkerPerms);
      console.log('Caseworker role assigned permissions');
    }

    // Candidate (role_id: 3) - View own cases
    const candidateRole = roles.find(r => r.id === 3);
    if (candidateRole) {
      const candidatePermNames = getCandidatePermissions();
      const candidatePerms = allPermissions.filter(p => candidatePermNames.includes(p.name));
      await candidateRole.setPermissions(candidatePerms);
      console.log('Candidate role assigned permissions');
    }

    // Sponsor/Business (role_id: 4) - Case, Payment, Reports
    const sponsorRole = roles.find(r => r.id === 4);
    if (sponsorRole) {
      const sponsorPermNames = getSponsorPermissions();
      const sponsorPerms = allPermissions.filter(p => sponsorPermNames.includes(p.name));
      await sponsorRole.setPermissions(sponsorPerms);
      console.log('Sponsor role assigned permissions');
    }

    console.log('Role permissions seeded successfully');
  } catch (error) {
    console.error('Error seeding role permissions:', error);
    throw error;
  }
};

const seedAll = async () => {
  try {
    await seedPermissions();
    await seedRolePermissions();
    console.log('All permissions and role permissions seeded successfully');
  } catch (error) {
    console.error('Error seeding permissions:', error);
    throw error;
  }
};

// Run seeder
seedAll()
  .then(() => {
    console.log('Seeder completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeder failed:', error);
    process.exit(1);
  });

export default seedAll;

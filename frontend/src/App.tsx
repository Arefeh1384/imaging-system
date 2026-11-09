import { Routes, type RouteDef } from './lib/router';
import { Landing, NotFound } from './features/public/Landing';
import { InviteEntry, PatientLogin } from './features/patient/PatientLogin';
import { CaseFlowPage, CaseListPage, ProfilePage } from './features/patient/PatientPortal';
import { InsuranceLogin } from './features/insurance/InsuranceShell';
import { InsuranceCasePage, InsuranceCasesPage, InsuranceDashboardPage } from './features/insurance/InsuranceAdmin';
import { AdminLayout, AdminLogin } from './features/admin/AdminShell';
import { AccountsPage } from './features/admin/AccountsPage';
import { CompanyPage, HospitalPage, OverviewPage, ZipListPage } from './features/admin/FinancePages';
import { ZipDetailPage } from './features/admin/ZipDetailPage';
import { PacsSimulator } from './features/admin/PacsSimulator';
import { PacsAdminLogin, PacsVolumePage } from './features/pacs-admin/PacsAdmin';

const routes: RouteDef[] = [
  { path: '/', element: <Landing /> },

  // Patient
  { path: '/c/:token', element: <InviteEntry /> },
  { path: '/portal/login', element: <PatientLogin /> },
  { path: '/portal', element: <CaseListPage /> },
  { path: '/portal/profile', element: <ProfilePage /> },
  { path: '/portal/cases/:caseId', element: <CaseFlowPage /> },

  // Insurance
  { path: '/insurance/login', element: <InsuranceLogin /> },
  { path: '/insurance/admin', element: <InsuranceDashboardPage /> },
  { path: '/insurance/admin/cases', element: <InsuranceCasesPage /> },
  { path: '/insurance/admin/cases/:caseId', element: <InsuranceCasePage /> },

  // PACS admin
  { path: '/pacs-admin/login', element: <PacsAdminLogin /> },
  { path: '/pacs-admin', element: <PacsVolumePage /> },

  // Main admin
  { path: '/admin/login', element: <AdminLogin /> },
  { path: '/admin', element: <AdminLayout><OverviewPage /></AdminLayout> },
  { path: '/admin/companies/:companyId', element: <AdminLayout><CompanyPage /></AdminLayout> },
  { path: '/admin/hospitals/:hospitalId', element: <AdminLayout><HospitalPage /></AdminLayout> },
  { path: '/admin/zips', element: <AdminLayout><ZipListPage /></AdminLayout> },
  { path: '/admin/zips/:zipId', element: <AdminLayout><ZipDetailPage /></AdminLayout> },
  { path: '/admin/accounts', element: <AdminLayout><AccountsPage /></AdminLayout> },
  { path: '/admin/pacs-simulator', element: <AdminLayout><PacsSimulator /></AdminLayout> },
];

export function App() {
  return <Routes routes={routes} fallback={<NotFound />} />;
}

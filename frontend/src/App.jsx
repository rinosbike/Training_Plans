import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LanguageSwitcher from './components/LanguageSwitcher'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import WorkoutDetail from './pages/WorkoutDetail'
import Nutrition from './pages/Nutrition'
import Progress from './pages/Progress'
import AICoach from './pages/AICoach'
import Sync from './pages/Sync'
import Settings from './pages/Settings'
import Credentials from './pages/Credentials'
import Branding from './pages/Branding'
import Translations from './pages/Translations'
import Admin from './pages/Admin'
import Content from './pages/Content'
import ContentStory from './pages/ContentStory'
import AuthCallback from './pages/AuthCallback'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/workout/:id" element={<Protected><WorkoutDetail /></Protected>} />
      <Route path="/nutrition" element={<Protected><Nutrition /></Protected>} />
      <Route path="/progress" element={<Protected><Progress /></Protected>} />
      <Route path="/ai-coach" element={<Protected><AICoach /></Protected>} />
      <Route path="/sync" element={<Protected><Sync /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/credentials" element={<Protected><Credentials /></Protected>} />
      <Route path="/branding" element={<Protected><Branding /></Protected>} />
      <Route path="/translations" element={<Protected><Translations /></Protected>} />
      <Route path="/admin/users" element={<Protected><Admin /></Protected>} />
      <Route path="/content" element={<Protected><Content /></Protected>} />
      <Route path="/content/:id" element={<Protected><ContentStory /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Global language switcher — visible on every page including login */}
        <div className="fixed top-3 right-3 z-[60]">
          <LanguageSwitcher variant="floating" />
        </div>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

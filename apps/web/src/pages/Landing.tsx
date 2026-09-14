import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-ayira-50 to-white px-4">
      <h1 className="text-5xl font-bold text-ayira-900 mb-4">Ayira</h1>
      <p className="text-xl text-gray-600 mb-8 text-center max-w-md">
        AI-powered gig platform connecting Africa's youth workforce with opportunities
      </p>
      <div className="flex gap-4">
        <Link to="/signup" className="bg-ayira-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-ayira-700 transition">
          Get Started
        </Link>
        <Link to="/signin" className="border border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition">
          Sign In
        </Link>
      </div>
    </div>
  );
}

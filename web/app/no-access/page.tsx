export default function NoAccessPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">No access</h1>
        <p className="text-gray-600">
          Your account hasn&apos;t been given access yet. Ask the finance lead to add your role
          in Clerk.
        </p>
      </div>
    </div>
  );
}

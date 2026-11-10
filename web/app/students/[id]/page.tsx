import StudentProfile from "./student-profile";

export function generateStaticParams() {
  // Provide a placeholder; real student pages are rendered client-side via SWR
  return [{ id: "0" }];
}

export default function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <StudentProfile params={params} />;
}

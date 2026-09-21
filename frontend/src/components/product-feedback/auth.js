import useAuthStore from "../../stores/authStore";
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  return {
    user: user
      ? { ...user, role: user.role === "super_admin" ? "admin" : "user" }
      : null,
  };
}

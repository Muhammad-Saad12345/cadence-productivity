import {
  Bell, CalendarClock, CalendarDays, ChartColumn, FolderKanban, LayoutDashboard, ListTodo, NotebookPen, Repeat,
  Settings, Sun, Target, Timer,
} from "lucide-react";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "main" },
  { href: "/today", label: "Today", icon: Sun, group: "main" },
  { href: "/upcoming", label: "Upcoming", icon: CalendarClock, group: "main" },
  { href: "/tasks", label: "All tasks", icon: ListTodo, group: "main" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, group: "main" },
  { href: "/goals", label: "Goals", icon: Target, group: "plan" },
  { href: "/projects", label: "Projects", icon: FolderKanban, group: "plan" },
  { href: "/habits", label: "Habits", icon: Repeat, group: "plan" },
  { href: "/focus", label: "Focus", icon: Timer, group: "plan" },
  { href: "/review", label: "Review", icon: NotebookPen, group: "insight" },
  { href: "/analytics", label: "Analytics", icon: ChartColumn, group: "insight" },
  { href: "/notifications", label: "Notifications", icon: Bell, group: "insight" },
  { href: "/settings", label: "Settings", icon: Settings, group: "insight" },
] as const;

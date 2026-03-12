import { BookOpen, Info, PenTool } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type SourceRole = "evidence" | "style_reference" | "background";

interface SourceRoleSelectorProps {
  sourceId: string;
  currentRole: SourceRole;
  onRoleChange: (role: SourceRole) => void;
}

const ROLE_OPTIONS: Array<{
  value: SourceRole;
  label: string;
  shortLabel: string;
  icon: typeof BookOpen;
}> = [
  { value: "evidence", label: "Evidence", shortLabel: "E", icon: BookOpen },
  { value: "style_reference", label: "Style Reference", shortLabel: "S", icon: PenTool },
  { value: "background", label: "Background", shortLabel: "B", icon: Info },
];

export function SourceRoleSelector({
  sourceId,
  currentRole,
  onRoleChange,
}: SourceRoleSelectorProps) {
  return (
    <div
      className="shrink-0"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <ToggleGroup
        type="single"
        value={currentRole}
        variant="outline"
        size="sm"
        className="flex-wrap justify-end"
        aria-label={`Source role for ${sourceId}`}
        onValueChange={(value) => {
          if (!value || value === currentRole) return;
          onRoleChange(value as SourceRole);
        }}
      >
        {ROLE_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              aria-label={option.label}
              title={option.label}
              className="h-7 min-w-[2rem] px-2 text-[10px] uppercase tracking-[0.12em]"
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{option.label}</span>
              <span className="lg:hidden">{option.shortLabel}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

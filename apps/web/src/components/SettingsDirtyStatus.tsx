import { IconAlertCircle } from "./RowIcons";

interface SettingsDirtyStatusProps {
  message?: string;
}

export function SettingsDirtyStatus({ message = "有未保存的更改" }: SettingsDirtyStatusProps) {
  return (
    <span className="settings-dirty-status">
      <IconAlertCircle className="settings-dirty-status__icon" />
      {message}
    </span>
  );
}

import { useState } from "react";
import type { ProviderProfile } from "@kako/shared";
import { getProviderEndpointId, getProviderModelLabel } from "@kako/shared";
import { ProviderIcon } from "./ProviderIcon";
import { IconCopy, IconEdit, IconPlay, IconSpinner, IconTestTube, IconTrash } from "./RowIcons";

interface ProviderRowProps {
  profile: ProviderProfile;
  isActive: boolean;
  testing?: boolean;
  activeModel?: string;
  onEnable: (model: string) => void;
  onEdit: () => void;
  onCopy: () => void;
  onTest: (model: string) => void;
  onDelete: () => void;
}

export function ProviderRow({
  profile,
  isActive,
  testing = false,
  activeModel,
  onEnable,
  onEdit,
  onCopy,
  onTest,
  onDelete,
}: ProviderRowProps) {
  const [hovered, setHovered] = useState(false);
  const endpoint = activeModel ?? getProviderEndpointId(profile);
  const displayName = getProviderModelLabel(profile, endpoint || undefined);
  const showEndpoint = Boolean(profile.modelAlias?.trim() && endpoint && profile.modelAlias?.trim() !== endpoint);
  const showActions = hovered || isActive || testing;

  return (
    <li
      className={`provider-row ${isActive ? "provider-row--active" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="provider-row__drag" title="拖拽排序（即将支持）">
        <span /><span /><span /><span /><span /><span />
      </div>

      <ProviderIcon preset={profile.preset} name={profile.name} />

      <div className="provider-row__body">
        <div className="provider-row__title">
          <span className="provider-row__name">{profile.name}</span>
          <span className="tag tag--muted">OpenAI 兼容</span>
          {!profile.enabled && <span className="tag tag--warn">已禁用</span>}
          {isActive && <span className="tag tag--active">当前使用</span>}
        </div>
        <a className="provider-row__url" href={profile.baseUrl} target="_blank" rel="noreferrer">
          {profile.baseUrl}
        </a>
        {endpoint && (
          <div className="provider-row__model">
            <span className="provider-row__model-name">{displayName}</span>
            {showEndpoint && (
              <span className="provider-row__model-endpoint">{endpoint}</span>
            )}
          </div>
        )}
      </div>

      <div className={`provider-row__actions ${showActions ? "visible" : ""}`}>
        {!isActive && (
          <button
            className="btn btn--enable"
            onClick={() => onEnable(endpoint)}
            disabled={!endpoint}
            title="启用并切换到此供应商"
          >
            <IconPlay className="btn__icon" />
            启用
          </button>
        )}
        <button className="icon-btn" onClick={onEdit} title="编辑">
          <IconEdit />
        </button>
        <button className="icon-btn" onClick={onCopy} title="复制">
          <IconCopy />
        </button>
        <button
          className="icon-btn"
          onClick={() => onTest(endpoint)}
          title={testing ? "测试中…" : "测试连接"}
          disabled={!endpoint || testing}
          aria-busy={testing}
        >
          {testing ? (
            <IconSpinner className="icon-btn__spinner" />
          ) : (
            <IconTestTube />
          )}
        </button>
        <button className="icon-btn icon-btn--danger" onClick={onDelete} title="删除">
          <IconTrash />
        </button>
      </div>
    </li>
  );
}

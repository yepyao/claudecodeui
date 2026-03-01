import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemContextInfo } from '../../types/types';

interface SystemContextBannerProps {
  systemContext?: SystemContextInfo;
  attachedFiles?: string;
  systemReminder?: string;
}

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  label: string;
  summary?: string;
  children: React.ReactNode;
}

function CollapsibleSection({ icon, label, summary, children }: CollapsibleSectionProps) {
  return (
    <details className="group">
      <summary className="flex items-center gap-2 cursor-pointer select-none py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
        <svg className="w-3 h-3 flex-shrink-0 transition-transform group-open:rotate-90 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="flex-shrink-0">{icon}</span>
        <span className="font-medium">{label}</span>
        {summary && (
          <span className="text-gray-400 dark:text-gray-500 truncate">{summary}</span>
        )}
      </summary>
      <div className="ml-5 mt-1 mb-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1.5 border border-gray-200/60 dark:border-gray-700/40">
        {children}
      </div>
    </details>
  );
}

const SystemContextBanner = memo(({ systemContext, attachedFiles, systemReminder }: SystemContextBannerProps) => {
  const { t } = useTranslation('chat');

  const hasContext = systemContext || attachedFiles;
  if (!hasContext && !systemReminder) return null;

  return (
    <div className="px-3 sm:px-0 space-y-1">
      {systemReminder && (
        <div className="flex items-center justify-center gap-2 py-1">
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          <span className="text-xs italic text-gray-400 dark:text-gray-500">
            {systemReminder}
          </span>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        </div>
      )}

      {hasContext && (
        <div className="border border-gray-200/70 dark:border-gray-700/50 rounded-lg bg-gray-50/50 dark:bg-gray-800/30 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{t('systemContext.title')}</span>
          </div>

          <div className="space-y-0.5">
            {systemContext?.userInfo && (
              <CollapsibleSection
                icon="💻"
                label={t('systemContext.userInfo')}
                summary={[
                  systemContext.userInfo.os,
                  systemContext.userInfo.shell,
                  systemContext.userInfo.workspace?.split('/').pop(),
                ].filter(Boolean).join(' · ')}
              >
                {systemContext.userInfo.raw}
              </CollapsibleSection>
            )}

            {systemContext?.gitStatus && (
              <CollapsibleSection
                icon="🔀"
                label={t('systemContext.gitStatus')}
                summary={systemContext.gitStatus.summary}
              >
                {systemContext.gitStatus.raw}
              </CollapsibleSection>
            )}

            {systemContext?.rules && systemContext.rules.length > 0 && (
              <CollapsibleSection
                icon="📋"
                label={t('systemContext.rules')}
                summary={t('systemContext.rulesCount', { count: systemContext.rules.length })}
              >
                {systemContext.rules.map((rule, i) => (
                  <details key={rule.name || i} className="group/rule mb-1 last:mb-0">
                    <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1">
                      <svg className="w-2.5 h-2.5 flex-shrink-0 transition-transform group-open/rule:rotate-90 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span>{rule.name}</span>
                    </summary>
                    <div className="ml-3.5 mt-0.5 text-gray-400 dark:text-gray-500 whitespace-pre-wrap">
                      {rule.content.length > 500 ? `${rule.content.slice(0, 500)}…` : rule.content}
                    </div>
                  </details>
                ))}
              </CollapsibleSection>
            )}

            {systemContext?.projectLayout && (
              <CollapsibleSection
                icon="📁"
                label={t('systemContext.projectLayout')}
                summary={`${systemContext.projectLayout.split('\n').filter(l => l.trim()).length} entries`}
              >
                {systemContext.projectLayout}
              </CollapsibleSection>
            )}

            {systemContext?.agentTranscripts && (
              <CollapsibleSection
                icon="📝"
                label={t('systemContext.agentTranscripts')}
              >
                {systemContext.agentTranscripts}
              </CollapsibleSection>
            )}

            {attachedFiles && (
              <CollapsibleSection
                icon="📎"
                label={t('systemContext.attachedFiles')}
              >
                {attachedFiles}
              </CollapsibleSection>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default SystemContextBanner;

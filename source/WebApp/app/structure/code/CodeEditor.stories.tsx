import React from 'react';
import { RecoilRoot } from 'recoil';
import { codeEditorPreviewEnabled } from '../../features/cm6-preview/codeEditorPreviewEnabled';
import { recoilTestState } from '../../shared/helpers/testing/recoilTestState';
import { LanguageName, LANGUAGE_CSHARP } from '../../shared/languages';
import { languageOptionState } from '../../shared/state/languageOptionState';
import { loadedCodeState } from '../../shared/state/loadedCodeState';
import { CodeEditor } from './CodeEditor';

export default {
    component: CodeEditor
};

type TemplateProps = {
    preview?: boolean;
};
// eslint-disable-next-line @typescript-eslint/no-empty-function
const doNothing = () => {};
const Template: React.FC<TemplateProps> = ({ preview } = {}) =>
    <RecoilRoot initializeState={recoilTestState(
        [codeEditorPreviewEnabled, !!preview],
        [languageOptionState, LANGUAGE_CSHARP as LanguageName],
        [loadedCodeState, 'using System;\r\n\r\nConsole.WriteLine("🌄");']
    )}>
        <CodeEditor
            onCodeChange={doNothing}
            onConnectionChange={doNothing}
            onServerError={doNothing}
            onSlowUpdateResult={doNothing}
            onSlowUpdateWait={doNothing}
            executionFlow={null}
            initialCached />
    </RecoilRoot>;

export const Default = () => <Template />;
export const Preview = () => <Template preview />;
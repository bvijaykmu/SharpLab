import { useExpander } from 'app/helpers/useExpander';
import React from 'react';
import type { DiagnosticWarning } from 'ts/types/results';
import { Diagnostic } from './Diagnostic';

type Props = {
    className: string;
    warnings: ReadonlyArray<DiagnosticWarning>;
};

export const WarningSection: React.FC<Props> = ({ className, warnings }) => {
    const { applyExpanderToClassName, ExpanderButton } = useExpander();

    if (warnings.length === 0)
        return null;

    const fullClassName = applyExpanderToClassName(className + ' ' + 'warnings block-section');
    return <section className={fullClassName}>
        <header>
            <ExpanderButton />
            <h1>Warnings</h1>
        </header>
        <div className="content">
            <ul>
                {warnings.map((w, i) => <li key={i.toString()}><Diagnostic data={w} /></li>)}
            </ul>
        </div>
    </section>;
};
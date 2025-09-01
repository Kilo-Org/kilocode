import React from 'react';
import DocItem from '@theme-original/DocItem';
import ReportIssue from '@site/src/components/ReportIssue';

export default function DocItemWrapper(props) {
  return (
    <>
      <DocItem {...props} />
      <ReportIssue />
    </>
  );
}
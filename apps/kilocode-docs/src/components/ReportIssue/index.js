import React from 'react';
import {useLocation} from '@docusaurus/router';
import {GITHUB_NEW_ISSUE_URL} from '@site/src/constants';
import styles from './styles.module.css';

export default function ReportIssue() {
  const {pathname} = useLocation();
  
  const issueUrl = `${GITHUB_NEW_ISSUE_URL}?title=Documentation%20Issue:%20${encodeURIComponent(pathname)}`;
  
  return (
    <div className={styles.reportContainer}>
      <hr className={styles.separator} />
      <div className={styles.reportLink}>
        <span>Is this documentation incorrect or incomplete? </span>
        <a href={issueUrl} target="_blank" rel="noopener noreferrer">
          Report an issue on GitHub
        </a>
      </div>
    </div>
  );
}
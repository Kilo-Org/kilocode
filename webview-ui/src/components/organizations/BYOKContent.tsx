import React from 'react';

interface BYOKContentProps {
	user?: {
		is_admin: boolean;
	};
	currentRole: string;
}

export const BYOKContent: React.FC<BYOKContentProps> = ({ user, currentRole }) => {
	const hasPermission = currentRole === 'owner';

	if (!hasPermission) {
		return (
			<div className="p-4">
				<p className="text-vscode-descriptionForeground">
					You must be an organization owner to access BYOK settings.
				</p>
			</div>
		);
	}

	return (
		<div className="p-4">
			<h2 className="text-lg font-semibold mb-4">BYOK Settings</h2>
			<p className="text-vscode-descriptionForeground mb-4">
				Configure your own keys for encryption.
			</p>
			{/* BYOK form content would go here */}
		</div>
	);
};

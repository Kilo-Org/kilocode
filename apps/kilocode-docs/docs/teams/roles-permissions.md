---
sidebar_label: Team Roles & Permissions
---

# Team Roles & Permissions

Kilo for Teams uses a three-tier role system designed for clear responsibility separation and secure team management.

## Role Overview

Every team member has one of three roles that determine their access level and capabilities within your organization.

### Owner

**Full administrative control** - The person who created the organization or was promoted by another owner.

**Key Responsibilities:**

- Financial management and billing oversight
- Strategic team planning and seat allocation
- Ultimate security and compliance authority

### Admin

**Team management without financial access** - Trusted team leads who manage day-to-day operations.

**Key Responsibilities:**

- Team member onboarding and management
- Usage monitoring and optimization
- Policy enforcement and compliance

### Member

**Standard usage access** - Individual contributors who use Kilo Code for development work.

**Key Responsibilities:**

- Personal usage monitoring
- Following team policies and guidelines
- Productive AI-assisted development

## Detailed Permissions Matrix

| Capability                       | Owner | Admin          | Member |
| -------------------------------- | ----- | -------------- | ------ |
| **Financial Management**         |
| Purchase AI credits              | ✅    | ❌             | ❌     |
| View billing history             | ✅    | ✅ (read-only) | ❌     |
| Manage payment methods           | ✅    | ❌             | ❌     |
| Download invoices                | ✅    | ✅             | ❌     |
| **Team Management**              |
| Add/remove members               | ✅    | ✅             | ❌     |
| Change member roles              | ✅    | ✅\*           | ❌     |
| Manage seat count                | ✅    | ❌             | ❌     |
| View team composition            | ✅    | ✅             | ✅     |
| **Usage Controls**               |
| Set daily usage limits           | ✅    | ✅             | ❌     |
| View all usage statistics        | ✅    | ✅             | ❌     |
| View personal usage              | ✅    | ✅             | ✅     |
| **Security & Compliance**        |
| Control data collection policies | ✅    | ✅             | ❌     |
| Manage model access permissions  | ✅    | ✅             | ❌     |
| Configure SSO settings           | ✅    | ❌             | ❌     |
| **Development Access**           |
| Use AI coding assistance         | ✅    | ✅             | ✅     |
| Access all enabled models        | ✅    | ✅             | ✅     |
| Personal settings management     | ✅    | ✅             | ✅     |

\*Admins can change roles for other members and admins, but cannot promote/demote owners.

## Role Assignment Best Practices

### Choose Owners Carefully

- Limit to 1-2 people maximum
- Select individuals with financial authority
- Ensure owners understand billing implications
- Consider succession planning

### Leverage Admin Role

- Assign to team leads and senior developers
- Perfect for those managing development workflows
- Ideal for compliance officers or security leads
- Use for people who need visibility without financial access

### Member Role for Most Users

- Default role for individual contributors
- Appropriate for contractors and temporary team members
- Suitable for junior developers learning the platform
- Best for users who only need coding assistance

## Changing Roles

### Promoting Members

1. Navigate to **Organization** tab
2. Find the team member in the list
3. Click the role dropdown next to their name
4. Select the new role
5. Confirm the change

### Role Change Limitations

- Only owners can promote other owners
- Admins cannot change owner roles
- Role changes take effect immediately
- Members are notified of role changes via email

## Security Considerations

### Owner Security

- Enable two-factor authentication
- Use strong, unique passwords
- Regularly review team access
- Monitor billing for unusual activity

### Admin Oversight

- Admins should regularly audit team usage
- Review and update usage limits quarterly
- Monitor for policy violations
- Ensure compliance with data policies

### Member Guidelines

- Members should report suspicious activity
- Follow organization data policies
- Use AI assistance responsibly
- Report technical issues promptly

## Common Role Scenarios

### Small Team (2-5 people)

- **1 Owner:** Founder or technical lead
- **1 Admin:** Senior developer or team lead
- **2-3 Members:** Individual contributors

### Medium Team (6-20 people)

- **1-2 Owners:** CTO and engineering manager
- **2-3 Admins:** Team leads and senior developers
- **15+ Members:** Individual contributors and junior developers

### Large Team (20+ people)

- **2 Owners:** CTO and VP of Engineering
- **4-6 Admins:** Team leads, security officer, compliance manager
- **20+ Members:** All other developers and contributors

## Troubleshooting Role Issues

### Can't Change Someone's Role

- Verify you have sufficient permissions (Owner or Admin)
- Check if you're trying to modify an Owner (only Owners can do this)
- Ensure the person is still an active team member

### Missing Permissions

- Confirm your current role in the Organization tab
- Contact an Owner or Admin if you need elevated access
- Check if your role was recently changed

### Billing Access Issues

- Only Owners can manage billing and payments
- Admins can view billing history but cannot make changes
- Contact an Owner for billing-related requests

## Next Steps

- [Learn about dashboard features](/teams/dashboard)
- [Set up team management policies](/teams/team-management)
- [Configure billing and credits](/teams/billing)

Understanding roles and permissions ensures your team operates securely and efficiently with clear accountability.

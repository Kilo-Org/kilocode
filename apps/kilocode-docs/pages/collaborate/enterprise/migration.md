---
title: "Migration"
description: "Migrate your team to Kilo Code Enterprise"
---

# Migration

Switch to **Kilo Teams** or **Kilo Enterprise** from other AI coding tools and experience transparent pricing, no vendor lock-in, and superior team management capabilities.

## Why Teams Switch to Kilo

### Transparency vs. Opacity

**Other AI coding vendors** hide their true costs behind opaque subscription models, leaving you wondering what you're actually paying for.

**Kilo Teams** and **Kilo Enterprise** show you exactly what each AI request costs - no markup, no hidden fees, complete transparency.

### No Rate Limiting

**Other tools** slow you down with rate limits and model switching when you need AI most.

**Kilo Teams** and **Kilo Enterprise** never limit your usage - pay for what you use, use what you need.

### True Team Management

**Other solutions** offer basic user management with limited visibility.

**Kilo Teams** provides comprehensive team analytics, role-based permissions, and detailed usage insights, while **Kilo Enterprise** adds advanced governance, audit logging, and enterprise-level security controls.

## Migrating from Cursor

### What You're Leaving Behind

- **Opaque pricing** - Never knowing true AI costs
- **Rate limiting** during peak usage periods
- **Limited team visibility** into usage patterns
- **Vendor lock-in** with proprietary systems
- **Hidden model switching** that degrades quality

### What You Gain with Kilo Teams or Kilo Enterprise

- **Transparent AI costs** - See exactly what providers charge
- **No rate limiting** - Use AI when you need it most
- **Comprehensive analytics** - Understand team usage patterns
- **Open source extension** - No vendor lock-in
- **Consistent quality** - No hidden model downgrades
- **Enterprise controls** _(Enterprise only)_ - SSO, audit logs, and advanced configuration options

### Migration Process

**Step 1: Team Assessment**

1. **Audit current Cursor usage** across your team
2. **Identify active users** and their usage patterns
3. **Calculate current costs** (if visible) vs. Kilo pricing
4. **Plan migration timeline** to minimize disruption

**Step 2: Kilo Setup**

1. **Create organization** at [app.kilocode.com](https://app.kilocode.com)
2. **Subscribe to Teams ($15/user/month)** or **Enterprise ([Contact Sales](https://kilo.ai/contact-sales))**
3. **Configure team settings** and usage policies
4. **Purchase initial AI credits** based on usage estimates

**Step 3: Team Migration**

1. **Invite team members** to Kilo
2. **Install Kilo Code extension** alongside Cursor initially
3. **Migrate projects gradually** starting with non-critical work
4. **Train team** on Kilo Code features and workflows

**Step 4: Full Transition**

1. **Monitor usage patterns** in Kilo dashboard
2. **Optimize settings** based on team feedback
3. **Cancel Cursor subscriptions** once fully migrated
4. **Uninstall Cursor** from team machines

### Cursor Feature Mapping

| Cursor Feature         | Kilo Equivalent                                                |
| ---------------------- | -------------------------------------------------------------- |
| AI Chat                | Chat interface with multiple modes                             |
| Code Generation        | Code mode with advanced tools                                  |
| Code Editing           | Fast edits and surgical modifications                          |
| Codebase Understanding | Codebase indexing and search                                   |
| Team Management        | Comprehensive team dashboard (Enterprise adds SSO, audit logs) |
| Usage Analytics        | Detailed usage and cost analytics                              |

## Migrating from GitHub Copilot

### Limitations You're Escaping

- **Limited model choice** - Stuck with GitHub's model selection
- **Basic team features** - Minimal team management capabilities
- **No cost visibility** - Hidden usage costs in subscription
- **Microsoft ecosystem lock-in** - Tied to Microsoft services
- **Limited customization** - Few options for team-specific needs

### Kilo Advantages

- **Multiple AI providers** - Choose from 18+ model providers
- **Advanced team management** - Roles, permissions, and analytics
- **Transparent pricing** - See exact costs for every request
- **Provider flexibility** - Switch providers or use your own API keys
- **Extensive customization** - Custom modes and team policies
- **Enterprise-level governance** _(Enterprise only)_ - Model filtering, audit logging, and compliance support

### Migration Strategy

**Phase 1: Parallel Usage (Week 1-2)**

1. **Keep GitHub Copilot** active during transition
2. **Install Kilo Code** extension for team members
3. **Start with simple tasks** in Kilo Code
4. **Compare results** and team satisfaction

**Phase 2: Gradual Transition (Week 3-4)**

1. **Use Kilo Code** for new projects
2. **Migrate existing projects** one at a time
3. **Train team** on advanced features
4. **Optimize usage patterns** based on analytics

**Phase 3: Full Migration (Week 5+)**

1. **Disable GitHub Copilot** for most team members
2. **Cancel GitHub Copilot** subscriptions
3. **Optimize Kilo Plan** settings
4. **Document new workflows** and best practices

### GitHub Copilot Feature Comparison

| GitHub Copilot   | Kilo                             | Advantage                     |
| ---------------- | -------------------------------- | ----------------------------- |
| Code suggestions | AI-powered code generation       | ✅ More model choices         |
| Chat interface   | Multi-mode chat system           | ✅ Specialized modes          |
| Team admin       | Comprehensive team management    | ✅ Enterprise adds audit logs |
| Usage insights   | Detailed usage and cost tracking | ✅ Transparent pricing        |
| Model selection  | 18+ AI providers and models      | ✅ No vendor lock-in          |

## Migrating from Other AI Coding Tools

### Common Migration Patterns

**From Tabnine**

- **Benefit:** More advanced AI models and team features
- **Process:** Export settings, migrate team, configure advanced features
- **Timeline:** 1-2 weeks for full transition

**From CodeWhisperer**

- **Benefit:** Escape AWS ecosystem lock-in, better team management
- **Process:** Parallel usage, gradual migration, team training
- **Timeline:** 2-3 weeks for enterprise teams

**From Replit AI**

- **Benefit:** Use in VS Code instead of web-based IDE
- **Process:** Export projects, set up local development, team onboarding
- **Timeline:** 3-4 weeks including development environment setup

### Universal Migration Checklist

**Pre-Migration Planning**

- [ ] Audit current AI coding tool usage
- [ ] Identify team members and their roles
- [ ] Calculate current costs vs. Kilo pricing
- [ ] Plan migration timeline and milestones
- [ ] Prepare team communication and training

**Migration Execution**

- [ ] Set up Kilo Organization
- [ ] Configure team settings and policies
- [ ] Invite team members and assign roles
- [ ] Install Kilo Code extension across team
- [ ] Start with pilot projects or non-critical work

**Post-Migration Optimization**

- [ ] Monitor usage patterns and costs
- [ ] Optimize team settings based on analytics
- [ ] Train team on advanced features
- [ ] Cancel previous AI coding tool subscriptions
- [ ] Document new workflows and best practices

## Technical Migration: Rules and Configurations

Kilo Code uses a compatible rules system that supports Cursor and Windsurf patterns. Migrating your custom rules and configurations is straightforward and typically takes 5-10 minutes per project.

**Quick Overview:**

- **Project rules**: `.cursor/rules/*.mdc` → `.kilocode/rules/*.md` (remove YAML frontmatter, keep Markdown content)
- **Legacy rules**: `.cursorrules` → `.kilocode/rules/legacy-rules.md`
- **AGENTS.md**: Works identically in Kilo Code (no conversion needed)
- **Global rules**: Recreate in `~/.kilocode/rules/*.md` directory

Kilo Code also supports mode-specific rules (`.kilocode/rules-{mode}/`), which Cursor and Windsurf don't have. This allows different rules for different workflows (e.g., Code mode vs Debug mode).

**👉 For detailed step-by-step instructions, format conversion examples, troubleshooting, and advanced migration scenarios, see our [Technical Migration Guide](/docs/getting-started/migrating).**

## Cost Comparison Analysis

### Hidden Costs in Other Tools

**Subscription Models Hide True Costs**

- Monthly fees regardless of actual usage
- No visibility into per-request costs
- Rate limiting forces inefficient workflows
- Model switching without notification

**Kilo Transparent Pricing**

- Pay exactly what AI providers charge
- See cost of every request in real-time
- No rate limiting or usage restrictions
- Choose optimal models for each task

### ROI Calculation Framework

**Current Tool Analysis**

1. **Monthly subscription costs** × team size
2. **Hidden productivity losses** from rate limiting
3. **Opportunity costs** from limited model access
4. **Management overhead** from poor team visibility

**Kilo Benefits**

1. **Transparent AI costs** (typically 30-50% lower)
2. **Productivity gains** from no rate limiting
3. **Better outcomes** from optimal model selection
4. **Reduced management time** with comprehensive analytics

## Team Training and Adoption

### Training Program Structure

**Week 1: Basics**

- Kilo Code extension installation and setup
- Basic chat interface and mode usage
- Understanding transparent pricing model
- Team dashboard overview

**Week 2: Advanced Features**

- Custom modes and specialized workflows
- Advanced tools and automation
- Team collaboration features
- Usage optimization strategies

**Week 3: Team Optimization**

- Analytics review and insights
- Cost optimization techniques
- Workflow integration and best practices
- Advanced team management features

### Adoption Best Practices

**Start Small**

- Begin with volunteer early adopters
- Use for non-critical projects initially
- Gather feedback and iterate
- Expand gradually across team

**Provide Support**

- Dedicated migration support channel
- Regular check-ins with team members
- Documentation and training resources
- Quick resolution of issues and questions

**Measure Success**

- Track usage adoption rates
- Monitor cost savings and efficiency gains
- Collect team satisfaction feedback
- Document success stories and best practices

## Common Migration Challenges

### Technical Challenges

**Extension Conflicts**

- **Issue:** Multiple AI coding extensions interfering
- **Solution:** Disable old extensions during transition
- **Prevention:** Staged migration with clear timelines

**Workflow Disruption**

- **Issue:** Team productivity dip during transition
- **Solution:** Parallel usage period with gradual migration
- **Prevention:** Comprehensive training and support

**Settings Migration**

- **Issue:** Lost customizations from previous tools
- **Solution:** Document and recreate important settings
- **Prevention:** Settings audit before migration

**Rules and Configuration Migration**

- **Issue:** Custom rules and configurations not migrating automatically
- **Solution:** Follow the [technical migration guide](/docs/getting-started/migrating) to manually migrate rules
- **Prevention:** Audit rules before migration, use version control for rules

### Organizational Challenges

**Change Resistance**

- **Issue:** Team members reluctant to switch tools
- **Solution:** Demonstrate clear benefits and provide training
- **Prevention:** Involve team in migration planning

**Budget Approval**

- **Issue:** Finance team concerns about new tool costs
- **Solution:** Provide detailed cost comparison and ROI analysis
- **Prevention:** Transparent pricing documentation

**Timeline Pressure**

- **Issue:** Pressure to migrate quickly without proper planning
- **Solution:** Phased migration approach with clear milestones
- **Prevention:** Realistic timeline planning with buffer time

## Migration Support

### Professional Migration Services

- **Migration planning** and timeline development
- **Team training** and onboarding support
- **Custom integration** development
- **Ongoing optimization** consulting

### Self-Service Resources

- **Migration guides** for specific tools
- **[Technical migration guide](/docs/getting-started/migrating)** for rules and configurations (Cursor/Windsurf)
- **Video tutorials** for common migration scenarios
- **Community support** through Discord and forums
- **Documentation** and best practices

### Getting Migration Help

- **Email:** migrations@kilo.ai
- **Discord:** Join our migration support channel
- **Consultation:** Schedule free migration planning call
- **Documentation:**
    - [Business migration guide](/docs/plans/migration) (this page)
    - [Technical migration guide](/docs/getting-started/migrating) (rules and configurations)

## Success Stories

### Mid-Size Software Company (25 developers)

**Previous:** Cursor Pro subscriptions  
**Challenge:** High costs with limited visibility  
**Result:** 40% cost reduction with better team insights  
**Timeline:** 3-week migration with zero productivity loss

### Enterprise Development Team (100+ developers)

**Previous:** GitHub Copilot Enterprise  
**Challenge:** Limited model choice and team management  
**Result:** Improved code quality and team collaboration  
**Timeline:** 6-week phased migration across multiple teams

### Startup Engineering Team (8 developers)

**Previous:** Multiple individual AI tool subscriptions  
**Challenge:** Expense report chaos and no team coordination  
**Result:** Centralized billing and improved team efficiency  
**Timeline:** 1-week migration with immediate benefits

## Next Steps

- [Get started with your team](/docs/plans/getting-started)
- [Explore team management features](/docs/plans/team-management)
- [Understand billing and pricing](/docs/plans/billing)
- [Migrate your rules and configurations](/docs/getting-started/migrating) (technical guide)

Ready to make the switch? Contact our migration team at migrations@kilo.ai to plan your transition to transparent AI coding.

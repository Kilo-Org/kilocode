I'll help complete the filter chain to get active users over 25.

<change>
<search><![CDATA[const activeAdults = users.filter(user => user.age > 25).]]></search>
<replace><![CDATA[const activeAdults = users.filter(user => user.age > 25).filter(user => user.active);]]></replace>
</change>

This adds a second filter to check the `active` property, ensuring we get users who are both over 25 AND active. The completed chain will return an array containing only the active users who are older than 25 years old.
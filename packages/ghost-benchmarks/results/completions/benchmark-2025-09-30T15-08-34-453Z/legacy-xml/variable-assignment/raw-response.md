I'll help complete the code to extract the names from the users array using map().

<change>
<search><![CDATA[const userNames = users.]]></search>
<replace><![CDATA[const userNames = users.map(user => user.name);]]></replace>
</change>

This completion:
1. Uses the map() array method to transform each user object
2. Extracts just the name property from each user
3. Creates a new array containing only the names
4. Follows common JavaScript conventions for arrow functions
5. Results in userNames containing ['Alice', 'Bob', 'Charlie']
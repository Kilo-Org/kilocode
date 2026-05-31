class Queue:
    def __init__(self):
        self.items = []

    def enqueue(self, item):
        self.items.append(item)

    def peek(self):
        return self.items[0] if self.items else None

    def size(self):
        return len(self.items)

    def is_empty(self):
        return not self.items

    def dequeue(self):


    def clear(self):
        self.items.clear()

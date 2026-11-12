"""Versioned capability contract; this package is installed separately from Margin."""
import json


def object_schema(properties, required=None):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required,
            "additionalProperties": False}


def string_schema(limit):
    return {"type": "string", "minLength": 1, "maxLength": limit}


SESSION = object_schema({"sessionId": string_schema(80)})
OK = object_schema({"ok": {"type": "boolean"}})


def action(name, title, description, inputs, outputs):
    return {"name": name, "title": title, "description": description,
            "inputSchema": inputs, "outputSchema": outputs}


MANIFEST = {
    "apiVersion": "margin.plugin/v1", "id": "python-notebook",
    "name": "Python notebooks", "version": "0.3.0",
    "description": "Explore ideas with Python cells that remember your work as you write.",
    "capabilities": ["notebook.execute"],
    "actions": [
        action("session.create", "Start a notebook", "Create a private Python kernel for this author.",
               object_schema({"notebookId": string_schema(200), "managed": {"type": "boolean"}}, ["notebookId"]), SESSION),
        action("cell.execute", "Run a cell", "Execute Python in an existing session. Results are returned when the cell finishes.",
               object_schema({"sessionId": string_schema(80), "code": {"type": "string", "minLength": 0, "maxLength": 65536}}),
               object_schema({"outputs": {"type": "array", "maxItems": 200,
                                          "items": {"type": "object", "additionalProperties": True}},
                              "executionCount": {"type": "integer", "minimum": 0}})),
        action("session.interrupt", "Stop execution", "Interrupt the current cell without waiting for it to finish.", SESSION, OK),
        action("session.restart", "Restart the notebook", "Clear variables and restart the session's kernel.", SESSION, OK),
        action("session.heartbeat", "Keep notebook open", "Renew the owner lease for an open notebook editor.", SESSION, OK),
        action("session.close", "Close the notebook", "Stop the kernel and remove its temporary files.", SESSION, OK),
    ],
}


STARTER_NOTEBOOK = {
    "nbformat": 4, "nbformat_minor": 5,
    "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}},
    "cells": [
        {"id": "intro", "cell_type": "markdown", "metadata": {},
         "source": ["## Explore an idea\n", "Run the first cell, then build on it in the next."]},
        {"id": "first", "cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
         "source": ["answer = 40\n", "print('Notebook ready')"]},
        {"id": "second", "cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
         "source": ["answer + 2"]},
    ],
}
MANIFEST["blocks"] = [{
    "id": "notebook", "title": "Jupyter notebook",
    "description": "Write, run, and share Python notebooks with saved results.",
    "entry": "ui/notebook.html", "defaultSource": json.dumps(STARTER_NOTEBOOK, indent=2),
    "actions": [item["name"] for item in MANIFEST["actions"]],
    "reader": True, "languages": ["ipynb"],
}]

// Package feedback shells out to the GitHub CLI (`gh`) to file issues and read
// their replies, so a self-hosted instance can send feedback without any
// embedded token.
package feedback

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Issue is a GitHub issue.
type Issue struct {
	Number    int       `json:"number"`
	Title     string    `json:"title"`
	State     string    `json:"state"`
	URL       string    `json:"url"`
	Author    string    `json:"author"`
	CreatedAt string    `json:"createdAt"`
	Body      string    `json:"body,omitempty"`
	Comments  []Comment `json:"comments,omitempty"`
}

// Comment is an issue reply.
type Comment struct {
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

// Available reports whether the `gh` CLI is on the PATH.
func Available() bool {
	_, err := exec.LookPath("gh")
	return err == nil
}

func run(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "gh", args...)
	var out, errb strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("gh %s: %s", strings.Join(args, " "), msg)
	}
	return []byte(out.String()), nil
}

// ghAuthor is how gh renders an author object.
type ghAuthor struct {
	Login string `json:"login"`
}

type ghComment struct {
	Author    ghAuthor `json:"author"`
	Body      string   `json:"body"`
	CreatedAt string   `json:"createdAt"`
}

type ghIssue struct {
	Number    int         `json:"number"`
	Title     string      `json:"title"`
	State     string      `json:"state"`
	URL       string      `json:"url"`
	Author    ghAuthor    `json:"author"`
	CreatedAt string      `json:"createdAt"`
	Body      string      `json:"body"`
	Comments  []ghComment `json:"comments"`
}

func (g ghIssue) toIssue() Issue {
	iss := Issue{Number: g.Number, Title: g.Title, State: g.State, URL: g.URL, Author: g.Author.Login, CreatedAt: g.CreatedAt, Body: g.Body}
	for _, c := range g.Comments {
		iss.Comments = append(iss.Comments, Comment{Author: c.Author.Login, Body: c.Body, CreatedAt: c.CreatedAt})
	}
	return iss
}

// List returns recent issues for a repository.
func List(ctx context.Context, repo string, limit int) ([]Issue, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	out, err := run(ctx, "issue", "list", "--repo", repo, "--limit", strconv.Itoa(limit),
		"--json", "number,title,state,url,author,createdAt")
	if err != nil {
		return nil, err
	}
	var raw []ghIssue
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("unexpected gh output: %w", err)
	}
	issues := make([]Issue, 0, len(raw))
	for _, g := range raw {
		issues = append(issues, g.toIssue())
	}
	return issues, nil
}

// View returns one issue with its comments.
func View(ctx context.Context, repo string, number int) (Issue, error) {
	out, err := run(ctx, "issue", "view", strconv.Itoa(number), "--repo", repo,
		"--json", "number,title,state,url,author,createdAt,body,comments")
	if err != nil {
		return Issue{}, err
	}
	var g ghIssue
	if err := json.Unmarshal(out, &g); err != nil {
		return Issue{}, fmt.Errorf("unexpected gh output: %w", err)
	}
	return g.toIssue(), nil
}

var issueURLRe = regexp.MustCompile(`/issues/(\d+)`)

// Create files a new issue and returns it.
func Create(ctx context.Context, repo, title, body string) (Issue, error) {
	args := []string{"issue", "create", "--repo", repo, "--title", title, "--body", body}
	out, err := run(ctx, args...)
	if err != nil {
		return Issue{}, err
	}
	if m := issueURLRe.FindStringSubmatch(string(out)); m != nil {
		if n, _ := strconv.Atoi(m[1]); n > 0 {
			return View(ctx, repo, n)
		}
	}
	return Issue{Title: title, State: "OPEN", URL: strings.TrimSpace(string(out))}, nil
}

// SetState closes or reopens an issue.
func SetState(ctx context.Context, repo string, number int, closed bool) error {
	action := "reopen"
	if closed {
		action = "close"
	}
	_, err := run(ctx, "issue", action, strconv.Itoa(number), "--repo", repo)
	return err
}

// AddComment adds a reply to an issue.
func AddComment(ctx context.Context, repo string, number int, body string) error {
	_, err := run(ctx, "issue", "comment", strconv.Itoa(number), "--repo", repo, "--body", body)
	return err
}
